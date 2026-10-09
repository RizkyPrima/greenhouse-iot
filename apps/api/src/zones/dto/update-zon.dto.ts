import { PartialType } from '@nestjs/swagger';
import { CreateZoneDto } from './create-zone.dto.js';

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}
