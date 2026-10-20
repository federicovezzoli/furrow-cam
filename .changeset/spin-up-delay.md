---
"@furrow/document": minor
"@furrow/post": minor
"@furrow/workspace": minor
"@furrow/web": minor
"@furrow/desktop": minor
---

G-code now waits for the spindle to reach speed (`G4`) after starting it or raising its speed, before the bit moves. Machine profiles have a spin-up delay, 5 seconds by default, for existing machines and projects too; a manual spindle, switched on by hand, gets no wait.
