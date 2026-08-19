FROM groonga/pgroonga:latest

ARG PGVECTOR_VERSION=v0.8.1
RUN apk add --no-cache --virtual .build-deps build-base git clang llvm-dev \
    && ln -s /usr/bin/clang-22 /usr/bin/clang-21 \
    && mkdir -p /usr/lib/llvm21/bin \
    && ln -s /usr/lib/llvm22/bin/llvm-lto /usr/lib/llvm21/bin/llvm-lto \
    && git clone --branch "${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" \
    && make -C /tmp/pgvector install \
    && rm -rf /tmp/pgvector \
    && apk del .build-deps
