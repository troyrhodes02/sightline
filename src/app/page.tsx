/**
 * Placeholder root. Replaced in SIG-35, where `/` redirects to `/slate` for an
 * authenticated caller and to `/sign-in` otherwise.
 *
 * It is unstyled on purpose — the theme arrives in SIG-31, and building a
 * styled screen before it exists is the exact rework this pitch is sequenced to
 * avoid.
 */
export default function Home() {
  return <main>Sightline</main>;
}
