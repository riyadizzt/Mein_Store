import { execSync } from 'child_process'

export default async function globalTeardown() {
  console.log('\n🧹 Stoppe Test-PostgreSQL...')
  execSync('docker compose -f docker-compose.test.yml down', {
    cwd: process.cwd().replace('/apps/api', ''),
    stdio: 'inherit',
  })
}
