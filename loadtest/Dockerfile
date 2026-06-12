# Locust load generator with a Socket.IO client for the realtime scenario.
FROM locustio/locust:2.31.8

# Base image runs as the unprivileged `locust` user; switch to root only to
# install the extra Python deps, then the entrypoint drops back automatically.
USER root
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
USER locust

COPY locustfile.py /home/locust/locustfile.py
WORKDIR /home/locust
