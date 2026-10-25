import { Redirect } from 'expo-router';

/** Kept so older tab routes resolve; Profile lives on the root stack. */
export default function ProfileTabRedirect() {
  return <Redirect href="/profile" />;
}
