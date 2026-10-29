// The G-code corpus's fixtures, which the export test reads, are imported as text.
declare module "*?raw" {
  const text: string;
  export default text;
}
