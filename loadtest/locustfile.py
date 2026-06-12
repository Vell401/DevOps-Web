"""
Load-test behaviour for the Task Tracker.

Run via the Locust web UI (http://localhost:8089): type the number of users
and spawn rate, press Start, watch live RPS / p95 / failure-% and per-endpoint
stats. Two user classes are mixed by weight:

  ApiUser       — weighted REST workflow (~80% reads / 20% writes) with login,
                  401-refresh handling and human-like think time.
  RealtimeUser  — holds an authenticated Socket.IO connection subscribed to a
                  project, to load the realtime gateway + Redis adapter.

Target is chosen with --host (compose sets it to the edge proxy so the full
nginx → backend path is measured). Login uses the accounts created by
`seed-bigdata.ts` (loadtest+N@tracker.local), so seed the DB first.
"""
import os
import random
import time

from locust import HttpUser, between, events, task

NUM_USERS = int(os.getenv("NUM_SEED_USERS", "100"))
PASSWORD = os.getenv("LOADTEST_PASSWORD", "loadtest1234")
# Share of spawned users that hold a websocket instead of doing REST.
WS_WEIGHT = int(os.getenv("WS_USER_WEIGHT", "1"))
REST_WEIGHT = int(os.getenv("REST_USER_WEIGHT", "9"))


def random_login():
    uid = random.randint(0, NUM_USERS - 1)
    return f"loadtest+{uid}@tracker.local"


class ApiUser(HttpUser):
    """Weighted REST workflow against the public API."""

    weight = REST_WEIGHT
    wait_time = between(3, 10)  # think time between actions

    def on_start(self):
        self.access = None
        self.refresh = None
        self.projects = []  # [{id, key}]
        self.tasks = []  # task ids seen in the last opened project
        self._login()
        if self.access:
            self._load_projects()

    # ---- auth ----

    def _login(self):
        with self.client.post(
            "/api/auth/login",
            json={"email": random_login(), "password": PASSWORD},
            name="POST /auth/login",
            catch_response=True,
        ) as r:
            if r.status_code == 200:
                body = r.json()
                self.access = body["accessToken"]
                self.refresh = body["refreshToken"]
            else:
                r.failure(f"login {r.status_code}")

    def _refresh_token(self) -> bool:
        if not self.refresh:
            return False
        r = self.client.post(
            "/api/auth/refresh",
            json={"refreshToken": self.refresh},
            name="POST /auth/refresh",
        )
        if r.status_code == 200:
            body = r.json()
            self.access = body["accessToken"]
            self.refresh = body["refreshToken"]
            return True
        return False

    def _headers(self):
        return {"Authorization": f"Bearer {self.access}"}

    def _get(self, path: str, name: str):
        """GET with a single transparent 401-refresh retry."""
        with self.client.get(path, headers=self._headers(), name=name, catch_response=True) as r:
            if r.status_code == 401 and self._refresh_token():
                r.success()  # the retry below is what counts
                return self.client.get(path, headers=self._headers(), name=name)
            if r.status_code >= 400:
                r.failure(f"{name} {r.status_code}")
            return r

    def _post(self, path: str, body, name: str):
        with self.client.post(path, json=body, headers=self._headers(), name=name, catch_response=True) as r:
            if r.status_code == 401 and self._refresh_token():
                r.success()
                return self.client.post(path, json=body, headers=self._headers(), name=name)
            if r.status_code >= 400:
                r.failure(f"{name} {r.status_code}")
            return r

    def _patch(self, path: str, body, name: str):
        with self.client.patch(path, json=body, headers=self._headers(), name=name, catch_response=True) as r:
            if r.status_code == 401 and self._refresh_token():
                r.success()
                return self.client.patch(path, json=body, headers=self._headers(), name=name)
            if r.status_code >= 400:
                r.failure(f"{name} {r.status_code}")
            return r

    def _load_projects(self):
        r = self._get("/api/projects", "GET /projects")
        try:
            self.projects = [{"id": p["id"], "key": p["key"]} for p in r.json().get("items", [])]
        except Exception:
            self.projects = []

    # ---- weighted tasks (higher weight = more frequent) ----

    @task(10)
    def browse_projects(self):
        self._get("/api/projects", "GET /projects")

    @task(8)
    def open_project(self):
        if not self.projects:
            return
        pid = random.choice(self.projects)["id"]
        r = self._get(f"/api/projects/{pid}/tasks", "GET /projects/:id/tasks")
        self._get(f"/api/projects/{pid}/labels", "GET /projects/:id/labels")
        self._get(f"/api/projects/{pid}/members", "GET /projects/:id/members")
        try:
            self.tasks = [t["id"] for t in r.json().get("items", [])]
        except Exception:
            self.tasks = []

    @task(6)
    def open_task(self):
        if not self.tasks:
            return
        tid = random.choice(self.tasks)
        self._get(f"/api/tasks/{tid}", "GET /tasks/:id")
        self._get(f"/api/tasks/{tid}/comments", "GET /tasks/:id/comments")
        self._get(f"/api/tasks/{tid}/activity", "GET /tasks/:id/activity")

    @task(5)
    def my_tasks(self):
        self._get("/api/tasks/mine", "GET /tasks/mine")

    @task(4)
    def notifications(self):
        self._get("/api/notifications/unread-count", "GET /notifications/unread-count")
        self._get("/api/notifications", "GET /notifications")

    @task(4)
    def global_activity(self):
        self._get("/api/activity", "GET /activity")

    @task(3)
    def move_task(self):
        if not self.tasks:
            return
        tid = random.choice(self.tasks)
        status = random.choice(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"])
        self._patch(f"/api/tasks/{tid}", {"status": status}, "PATCH /tasks/:id (move)")

    @task(2)
    def post_comment(self):
        if not self.tasks:
            return
        tid = random.choice(self.tasks)
        self._post(f"/api/tasks/{tid}/comments", {"body": "load test comment"}, "POST /tasks/:id/comments")

    @task(1)
    def create_task(self):
        if not self.projects:
            return
        pid = random.choice(self.projects)["id"]
        self._post(
            f"/api/projects/{pid}/tasks",
            {"title": f"LT task {random.randint(0, 1_000_000)}", "priority": "MEDIUM"},
            "POST /projects/:id/tasks",
        )


# --- Optional Socket.IO load. Imported lazily so the REST suite still runs
# even if the websocket client isn't installed. ---
try:
    import socketio  # python-socketio[client]

    _HAS_SOCKETIO = True
except Exception:  # pragma: no cover
    _HAS_SOCKETIO = False


class RealtimeUser(HttpUser):
    """Holds one authenticated Socket.IO connection subscribed to a project."""

    weight = WS_WEIGHT if _HAS_SOCKETIO else 0
    wait_time = between(20, 40)  # mostly idle: the value is the open connection

    def on_start(self):
        self.sio = None
        # Reuse the REST login to get a token + a project to subscribe to.
        login = self.client.post(
            "/api/auth/login",
            json={"email": random_login(), "password": PASSWORD},
            name="WS login",
        )
        if login.status_code != 200:
            return
        token = login.json()["accessToken"]
        projects = self.client.get(
            "/api/projects", headers={"Authorization": f"Bearer {token}"}, name="WS load projects"
        )
        items = projects.json().get("items", []) if projects.status_code == 200 else []
        if not items:
            return
        self._connect(token, items[0]["id"])

    def _connect(self, token: str, project_id: str):
        start = time.time()
        self.sio = socketio.Client(reconnection=False)

        @self.sio.on("task-upserted")
        def _on_event(_data):
            events.request.fire(
                request_type="WS",
                name="event task-upserted",
                response_time=0,
                response_length=0,
                exception=None,
            )

        try:
            # Path matches the gateway + edge proxy (/api/socket.io).
            self.sio.connect(
                self.host,
                socketio_path="/api/socket.io",
                transports=["websocket"],
                auth={"token": token},
                wait_timeout=10,
            )
            self.sio.emit("subscribe-project", project_id)
            events.request.fire(
                request_type="WS",
                name="connect",
                response_time=(time.time() - start) * 1000,
                response_length=0,
                exception=None,
            )
        except Exception as exc:  # connection failed
            events.request.fire(
                request_type="WS",
                name="connect",
                response_time=(time.time() - start) * 1000,
                response_length=0,
                exception=exc,
            )
            self.sio = None

    @task
    def keep_alive(self):
        # The open connection IS the load; nothing to do but stay connected.
        if self.sio is None:
            self.on_start()

    def on_stop(self):
        if self.sio is not None:
            try:
                self.sio.disconnect()
            except Exception:
                pass
