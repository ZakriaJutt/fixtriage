export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWebCheckIn } = await import('./src/server');
    startWebCheckIn();
  }
}
