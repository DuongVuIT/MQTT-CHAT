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
