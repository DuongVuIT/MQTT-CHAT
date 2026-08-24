import mqtt, { type MqttClient } from "mqtt";
import type { Logger } from "@mqtt-chat/logger";

export type { MqttClient };

/**
 * MQTT client factory + lifecycle helpers.
 * Contains NO chat business rules — only connection concerns:
 * reconnect policy, subscription management, publishing, graceful shutdown.
 */

export interface MqttClientOptions {
  url: string;
  clientId: string;
  /** Last Will & Testament — published when the client disconnects abruptly. */
  will?: { topic: string; payload: string; qos: 0 | 1; retain: boolean };
  logger: Logger;
  clean?: boolean;
  keepalive?: number;
  reconnectPeriod?: number;
  connectTimeout?: number;
  /**
   * Deferred-ack delivery handler for QoS1 CONSUMERS (e.g. chat-worker).
   * mqtt.js PUBACKs a QoS1 publish the moment it is handed over — BEFORE any
   * consumer logic runs — so "acked then crashed" silently loses the command
   * and at-least-once never actually reaches the handler. When this option is
   * set, deliveries are routed here instead and the ack goes out only after
   * the returned promise RESOLVES; a REJECTION skips the PUBACK entirely, so
   * the broker redelivers (true crash-safe at-least-once). Consumers using
   * this option must NOT also subscribe to the 'message' event (mqtt.js still
   * emits it before invoking this hook) or every command would be processed
   * twice.
   */
  handleMessage?: (topic: string, payload: Buffer) => Promise<void>;
}

/** Create a configured MQTT client with normalized logging. */
export function createMqttClient(options: MqttClientOptions): MqttClient {
  const log = options.logger.child({ component: "mqtt", clientId: options.clientId });
  const client = mqtt.connect(options.url, {
    clientId: options.clientId,
    clean: options.clean ?? true,
    keepalive: options.keepalive ?? 30,
    // Reconnect with capped backoff is built into mqtt.js.
    reconnectPeriod: options.reconnectPeriod ?? 2000,
    connectTimeout: options.connectTimeout ?? 10_000,
    ...(options.will
      ? {
          will: {
            topic: options.will.topic,
            payload: Buffer.from(options.will.payload),
            qos: options.will.qos,
            retain: options.will.retain,
          },
        }
      : {}),
  });

  client.on("connect", () => log.info("MQTT connected"));
  client.on("reconnect", () => log.debug("MQTT reconnecting"));
  client.on("close", () => log.debug("MQTT closed"));
  client.on("offline", () => log.warn("MQTT offline"));
  client.on("error", (err) => log.error("MQTT error", { error: err.message }));

  if (options.handleMessage) {
    const userHandler = options.handleMessage;
    // mqtt.js invokes the INSTANCE method handleMessage(packet, cb) after
    // emitting 'message'; the PUBACK is sent only once our callback runs, and
    // an ERROR callback skips the ack entirely (broker → redelivery). The
    // internal `done` it chains to ignores errors, so rejecting here is safe:
    // no crash, simply no ack.
    client.handleMessage = (packet, callback) => {
      const payload = Buffer.isBuffer(packet.payload)
        ? packet.payload
        : Buffer.from(packet.payload);
      userHandler(packet.topic ?? "", payload)
        .then(() => callback())
        .catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error));
          log.warn("Deferred-ack handler failed — skipping PUBACK so the broker redelivers", {
            topic: packet.topic,
            error: err.message,
          });
          callback(err);
        });
    };
  }

  return client;
}

/** Promise-based subscribe that resolves on granted subscription. */
export function subscribe(client: MqttClient, topic: string, qos: 0 | 1): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Promise-based unsubscribe. */
export function unsubscribe(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.unsubscribe(topic, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Publish a JSON-serializable payload. */
export function publishJson(
  client: MqttClient,
  topic: string,
  payload: unknown,
  qos: 0 | 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Wait until the client is connected (or timeout). */
export function waitForConnect(client: MqttClient, timeoutMs = 15_000): Promise<void> {
  if (client.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`MQTT connect timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const onConnect = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      client.off("connect", onConnect);
      client.off("error", onError);
    };
    client.once("connect", onConnect);
    client.once("error", onError);
  });
}

/** Graceful shutdown: end connection, wait for outgoing messages to flush. */
export async function closeMqttClient(client: MqttClient, timeoutMs = 5_000): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    client.end(false, {}, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
