import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Needed for Stripe/Klarna webhook signature verification
  })

  // Security
  app.use(cookieParser())
  app.use(helmet())
  app.enableCors({
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    credentials: true,
  })

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // API Prefix
  app.setGlobalPrefix('api/v1')

  // Swagger Docs (nur in Development)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Omnichannel Store API')
      .setDescription('Malak Retail Platform — AR/EN/DE')
      .setVersion('1.0')
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
  }

  const port = process.env.API_PORT || 3001
  await app.listen(port)
  console.log(`🚀 API läuft auf: http://localhost:${port}/api/v1`)
  console.log(`📚 Swagger Docs: http://localhost:${port}/api/docs`)
}

bootstrap()
