import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import { AppModule } from "./app.module";
import { loadServerEnv } from "@mqtt-chat/config";

// Port is overridable so the isolated E2E stack can bind elsewhere (:3011);
// normal development always runs on 3001 behind the public gateway.
const PORT = Number(process.env.PORT ?? 3001);

async function bootstrap(): Promise<void> {
  loadServerEnv(); // fail fast on invalid env
  const app = await NestFactory.create(AppModule);
  // SINGLE PUBLIC ORIGIN: the gateway proxies /api/* here, so every route is
  // served under the canonical `/api` prefix (e.g. GET /api/health).
  // The bare root (GET /) stays unprefixed as a service-identity probe.
  app.setGlobalPrefix("api", {
    exclude: [{ path: "/", method: RequestMethod.GET }],
  });
  app.enableCors({ origin: true }); // demo: allow web/admin origins
  await app.listen(PORT);
  console.log(`API listening on http://localhost:${PORT} (routes under /api)`);
}

void bootstrap();
