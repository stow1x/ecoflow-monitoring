FROM grafana/grafana:13.2.0

# Nothing this image needs may live under /var/lib/grafana: that path is the grafana_data named
# volume, and a populated volume shadows whatever the image has beneath it, so the files would
# freeze at whatever version first seeded the volume. Dashboards therefore go to /etc/grafana,
# and provisioning/dashboards/ecoflow.yml points there. CI enforces both halves of this.
COPY provisioning /etc/grafana/provisioning
COPY dashboards /etc/grafana/dashboards
