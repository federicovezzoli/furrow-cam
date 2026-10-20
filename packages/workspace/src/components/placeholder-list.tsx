import { PLACEHOLDERS } from "@furrow/post";

/** The placeholders the post fills in a custom block, as a sentence for a hint. */
export function PlaceholderList() {
  const entries = Object.entries(PLACEHOLDERS);
  return (
    <>
      On export,{" "}
      {entries.map(([placeholder, meaning], i) => (
        <span key={placeholder}>
          <code>{placeholder}</code> becomes {meaning}
          {i < entries.length - 2 ? ", " : i === entries.length - 2 ? " and " : ""}
        </span>
      ))}
      , all measured from the zero.
    </>
  );
}
