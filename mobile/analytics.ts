import PostHog from 'posthog-react-native';

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY?.trim();
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

export const analytics = apiKey ? new PostHog(apiKey, {
  host,
  flushAt: 1,
  flushInterval: 5_000,
  captureAppLifecycleEvents: true,
  enableSessionReplay: false,
}) : null;

type AnalyticsValue = string | number | boolean | null | AnalyticsValue[] | { [key: string]: AnalyticsValue };

export function captureEvent(event: string, properties: Record<string, AnalyticsValue> = {}): void {
  try {
    analytics?.capture(event, properties);
  } catch {
    // Telemetry must never become another reason the fight cannot start.
  }
}
