FROM projectdiscovery/nuclei:latest

# Download and install nuclei templates at build time
# so scans with severity filters work out of the box
RUN nuclei -update-templates -disable-update-check 2>/dev/null || true

# Templates are now at /root/nuclei-templates/
ENTRYPOINT ["nuclei"]
