FROM oven/bun:debian

RUN apt update
RUN apt install -y openjdk-17-jdk

USER bun

WORKDIR /opt/server
COPY --chown=bun:bun . .

WORKDIR /opt/server/engine
RUN bun install
RUN bun run build

WORKDIR /opt/server/engine
EXPOSE 8888/tcp
ENTRYPOINT [ "bun", "run", "quickstart" ]
