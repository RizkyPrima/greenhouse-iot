import { PartialType } from '@nestjs/swagger';
import { CreateGreenhouseDto } from './create-greenhouse.dto.js';

export class UpdateGreenhouseDto extends PartialType(CreateGreenhouseDto) {}
