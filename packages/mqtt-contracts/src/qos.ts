/**
 * Intentional QoS policy per message class.
 * QoS 2 is deliberately avoided (no technical reason; adds overhead).
 */

export const MQTT_QOS = {
  /** Message/reaction/receipt commands: at-least-once, dedup via clientMessageId. */
  command: 1,
  /** Canonical events: at-least-once, consumers must be idempotent. */
  event: 1,
  /** Typing indicators: ephemeral, loss is acceptable. */
  ephemeral: 0,
} as const;

export type MqttQos = 0 | 1;
