export type SessionUserDto = {
  id: string;
  email: string;
  /** Null renders as the email address — never a blank, never a system id. */
  displayName: string | null;
  role: "admin" | "viewer";
};
