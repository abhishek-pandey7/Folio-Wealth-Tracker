import { Module } from '@nestjs/common';
import { MarketController } from './market.controller.js';
import { MarketGatewayClient } from './market-gateway.client.js';

@Module({
  controllers: [MarketController],
  providers: [MarketGatewayClient],
  exports: [MarketGatewayClient],
})
export class MarketModule {}
