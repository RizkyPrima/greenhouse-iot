import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const host = configService.get<string>('app.host') || '0.0.0.0';
  const port = configService.get<number>('app.port') || 3001;
  const corsOrigin = configService.get<string>('app.corsOrigin') || 'http://localhost:3000';

  // Enable graceful shutdown hooks (SIGTERM, SIGINT)
  app.enableShutdownHooks();

  // Set global API prefix
  app.setGlobalPrefix('api');

  // CORS Configuration
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID'],
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Greenhouse IoT Platform API')
    .setDescription('Backend REST API foundation for Greenhouse IoT Platform')
    .setVersion('0.1.0')
    .addTag('Health', 'System and infrastructure health status')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Greenhouse IoT Platform API Docs',
  });

  await app.listen(port, host);

  logger.log(`======================================================`);
  logger.log(`Greenhouse API is running on: http://${host}:${port}/api`);
  logger.log(`Health Check endpoint     : http://${host}:${port}/api/health`);
  logger.log(`Swagger Documentation     : http://${host}:${port}/api/docs`);
  logger.log(`CORS allowed origin       : ${corsOrigin}`);
  logger.log(`======================================================`);
}

bootstrap().catch((err) => {
  Logger.flush();
  const logger = new Logger('Bootstrap');
  logger.error(`Application failed to start: ${err.message}`, err.stack);
  process.exit(1);
});
