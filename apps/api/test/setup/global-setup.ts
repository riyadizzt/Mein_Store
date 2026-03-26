import { execSync } from 'child_process'

export default async function globalSetup() {
  console.log('\n🐳 Starte Test-PostgreSQL via Docker...')

  // Test-DB hochfahren
  execSync('docker compose -f docker-compose.test.yml up -d --wait', {
    cwd: process.cwd().replace('/apps/api', ''),
    stdio: 'inherit',
  })

  // Schema auf Test-DB anwenden
  process.env.DATABASE_URL =
    'postgresql://postgres:postgres_test@localhost:5433/omnichannel_test'
  process.env.DIRECT_URL = process.env.DATABASE_URL

  execSync('prisma db push --schema=./prisma/schema.prisma --skip-generate', {
    cwd: process.cwd().replace('/apps/api', ''),
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
    },
    stdio: 'inherit',
  })

  console.log('✅ Test-DB bereit\n')
}
