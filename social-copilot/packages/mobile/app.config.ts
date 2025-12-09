import { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Social Copilot',
  slug: 'social-copilot',
  version: '0.1.0',
  orientation: 'portrait',
  platforms: ['ios', 'android'],
  extra: {},
});
