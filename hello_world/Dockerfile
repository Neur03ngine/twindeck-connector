FROM ghcr.io/home-assistant/base:3.24
ARG BUILD_ARCH
ARG BUILD_VERSION
LABEL io.hass.type="app" \
      io.hass.name="Hello World" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.version="${BUILD_VERSION}" \
      org.opencontainers.image.source="https://github.com/Neur03ngine/twindeck-connector" \
      org.opencontainers.image.version="${BUILD_VERSION}"
COPY run.sh /run.sh
RUN chmod 0755 /run.sh
CMD ["/run.sh"]
