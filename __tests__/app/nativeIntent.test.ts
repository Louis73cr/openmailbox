import { redirectSystemPath } from '../../app/+native-intent';

describe('native intent', () => {
  it('stays on the current screen when a sign-in page answers', () => {
    expect(redirectSystemPath({ path: 'com.soluce.openmailbox:/oauth2redirect?code=x', initial: false })).toBe('');
    expect(redirectSystemPath({ path: 'openmailbox://oauth?code=x', initial: false })).toBe('');
    expect(redirectSystemPath({ path: 'com.googleusercontent.apps.1-a:/oauth2redirect?code=x', initial: true })).toBe('/');
  });

  it('opens what was shared in a new message and other links as they are', () => {
    expect(redirectSystemPath({ path: 'openmailbox://expo-sharing?id=1', initial: true })).toBe('/compose?shared=1');
    expect(redirectSystemPath({ path: '/thread/1', initial: false })).toBe('/thread/1');
  });
});
