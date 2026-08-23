import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Controller("health")
export class HealthController {
  // Explicit token: tsx/esbuild does not emit design:paramtypes metadata.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<{ status: string; database: string }> {
    let database = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }
    return { status: database === "up" ? "ok" : "degraded", database };
  }
}
