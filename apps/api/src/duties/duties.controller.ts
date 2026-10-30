import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireDateParam } from '../common/dates';
import { parseBody, zDate, zTime } from '../common/validation';
import { DutiesService } from './duties.service';

const tripsBody = z.object({
  trips: z.array(
    z.object({
      loadingId: z.string().nullish().transform((v) => v || null),
      drops: z.array(
        z.object({
          orderId: z.string().min(1),
          stationId: z.string().min(1),
          quantityKL: z.number().positive(),
          compartmentIdx: z.array(z.number().int().min(0)).min(1),
        }),
      ),
    }),
  ),
});

@Controller()
export class DutiesController {
  constructor(private readonly duties: DutiesService) {}

  @Get('board')
  board(@Query('date') date: string) {
    return this.duties.board(requireDateParam(date));
  }

  @Get('duties')
  list(@Query('from') from: string, @Query('to') to: string) {
    return this.duties.list(requireDateParam(from, '起始日期'), requireDateParam(to, '結束日期'));
  }

  @Post('duties')
  create(@Body() body: unknown) {
    return this.duties.create(parseBody(z.object({ driverId: z.string().min(1), date: zDate, startTime: zTime.optional() }), body));
  }

  @Get('duties/:id')
  get(@Param('id') id: string) {
    return this.duties.get(id);
  }

  @Patch('duties/:id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.duties.update(id, parseBody(z.object({ startTime: zTime.optional(), vehicleId: z.string().nullable().optional() }), body));
  }

  @Put('duties/:id/trips')
  replaceTrips(@Param('id') id: string, @Body() body: unknown) {
    return this.duties.replaceTrips(id, parseBody(tripsBody, body).trips);
  }

  @Delete('duties/:id')
  remove(@Param('id') id: string) {
    return this.duties.remove(id);
  }

  @Get('duties/:id/evaluation')
  async evaluation(@Param('id') id: string) {
    return (await this.duties.evaluate(id)).evaluation;
  }

  @Post('duties/:id/publish')
  publish(@Param('id') id: string, @Body() body: unknown) {
    return this.duties.publish(id, parseBody(z.object({ reason: z.string().max(1000).nullish() }), body).reason);
  }

  @Post('duties/:id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.duties.unpublish(id);
  }

  @Get('dispatch-sheets')
  dispatchSheets(@Query('date') date: string) {
    return this.duties.dispatchSheets(requireDateParam(date));
  }
}
