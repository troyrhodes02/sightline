import { AccessDenied } from "@/components/screens/Terminal";

/**
 * Rendered by `forbidden()` when a viewer reaches an admin route.
 *
 * Deliberately says nothing about what is behind the route. "You need admin
 * access to view the decision log" would confirm the decision log exists, which
 * is precisely what a viewer must not be able to infer.
 */
export default function Forbidden() {
  return <AccessDenied />;
}
