# Skill: storage

Upload flow: client requests presign -> API validates MIME/size -> presigned URL -> client uploads binary directly to MinIO/R2 -> complete -> MQTT message carries metadata only. Never send binaries through MQTT or API.
