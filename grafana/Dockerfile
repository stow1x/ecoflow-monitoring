FROM grafana/grafana:13.2.0

# Dashboards deliberately live outside /var/lib/grafana: the named volume mounts there, and a
# populated volume would shadow this directory on every later image update.
COPY provisioning /etc/grafana/provisioning
COPY dashboards /etc/grafana/dashboards
