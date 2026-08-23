import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadServerEnv } from "@mqtt-chat/config";

const PORT = 3001;

async function bootstrap(): Promise<void> {
  loadServerEnv(); // fail fast on invalid env
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true }); // demo: allow web/admin origins
  await app.listen(PORT);
  console.log(`API listening on http://localhost:${PORT}`);
}

void bootstrap();
