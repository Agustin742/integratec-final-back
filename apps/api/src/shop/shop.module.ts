import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PointsModule } from '../points/points.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopPurchaseRateLimiter } from './shop-purchase-rate-limiter.service';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

/** Server-owned classroom shop catalog, purchase history, and atomic purchase endpoints. */
@Module({
  imports: [PrismaModule, AccessModule, PointsModule],
  controllers: [ShopController],
  providers: [ShopService, ShopPurchaseRateLimiter],
  exports: [ShopService, ShopPurchaseRateLimiter],
})
export class ShopModule {}
