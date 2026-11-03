// The Ask AI companion: one of Menagerie's pixel animals (github.com/devkancheti4-design/menagerie, Apache-2.0).
// It sleeps when the chat is quiet, runs across while the model reads, types while the answer streams, jumps when it
// lands and raises the alarm when a request fails. Click it to meet the next animal; the choice stays in this browser.
const PETS = new URL("./pets/", import.meta.url);
const PET_KEY = "spirithub-hub:ai-pet";
const SLEEP_AFTER = 22000;
const RUN_SPEED = 0.09; // px per ms across the stage
const W = 192;
const H = 208; // one frame of the sprite sheet
// row, frames, one loop in ms: the moves of the Petdex sprite format the Menagerie animals are drawn in
const MOVES = { ready: [0, 6, 1100], right: [1, 8, 1060], left: [2, 8, 1060], hello: [3, 4, 700], done: [4, 5, 840],
  failed: [5, 8, 1220], asleep: [6, 6, 1010], typing: [8, 6, 1030] };
const STATUS = { ready: "ready", asleep: "asleep", thinking: "reading…", typing: "typing…", done: "done", failed: "couldn't answer", hello: "hello!" };
const LOOPS = { done: 2, hello: 2, failed: 4 }; // moods that play a few times, then hand back

let list;
const petList = () => (list ||= fetch(new URL("pets.json", PETS)).then((response) => response.json()).then((data) => data.pets)
  .catch(() => [{ id: "mochi", name: "Mochi" }]));
const sheets = new Map();
function sheet(id) {
  if (!sheets.has(id)) {
    const image = new Image();
    image.src = new URL(`${id}.png`, PETS).href;
    sheets.set(id, image);
  }
  return sheets.get(id);
}
const saved = {
  get() {
    try {
      return localStorage.getItem(PET_KEY);
    } catch {
      return null;
    }
  },
  set(id) {
    try {
      localStorage.setItem(PET_KEY, id);
    } catch {
      // Private mode: the choice lasts until the tab closes.
    }
  },
};

export function createPet() {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: W, height: H, className: "ai-pet", tabIndex: 0 });
  canvas.setAttribute("role", "button");
  const name = Object.assign(document.createElement("span"), { className: "ai-pet-name" });
  const status = Object.assign(document.createElement("span"), { className: "ai-pet-status" });
  const track = Object.assign(document.createElement("div"), { className: "ai-stage-track" });
  const label = Object.assign(document.createElement("div"), { className: "ai-pet-label" });
  const node = Object.assign(document.createElement("div"), { className: "ai-stage" });
  track.append(canvas);
  label.append(name, status);
  node.append(track, label);
  const context = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let pet = { id: saved.get() || "mochi", name: "" };
  let mood = "ready";
  let back = "ready"; // the mood to return to after a mood that plays a few times
  let since = performance.now();
  let lastSeen = since;
  let x = 0;
  let heading = 1;
  let lastFrame = 0;
  let frame = 0;

  const paint = () => {
    name.textContent = pet.name;
    status.textContent = STATUS[mood];
    canvas.title = `${pet.name || "Your companion"}: click to meet the next animal`;
    canvas.setAttribute("aria-label", `${pet.name}, ${STATUS[mood]}. Click to meet the next animal.`);
  };
  const set = (next, after = "ready") => {
    if (next === "typing" || next === "ready" || next === "asleep") x = 0;
    mood = next;
    back = after;
    since = performance.now();
    paint();
    start();
  };

  function tick(now) {
    frame = 0;
    if (!node.isConnected || node.offsetParent === null || document.hidden) return; // resumes when shown or woken
    const step = Math.min(64, now - (lastFrame || now));
    lastFrame = now;
    if (mood === "ready" && now - lastSeen > SLEEP_AFTER) set("asleep");
    let move = mood;
    if (mood === "thinking") {
      const room = Math.max(0, track.clientWidth - canvas.clientWidth);
      if (!still.matches) {
        x += heading * RUN_SPEED * step;
        if (x >= room || x <= 0) heading = x >= room ? -1 : 1;
        x = Math.min(room, Math.max(0, x));
      }
      move = heading > 0 ? "right" : "left";
    }
    const [row, frames, loop] = MOVES[move];
    if (LOOPS[mood] && now - since >= LOOPS[mood] * loop) {
      set(back);
      return;
    }
    const index = still.matches ? 0 : Math.floor(((now - since) % loop) / (loop / frames));
    const image = sheet(pet.id);
    context.clearRect(0, 0, W, H);
    if (image.complete && image.naturalWidth) context.drawImage(image, index * W, row * H, W, H, 0, 0, W, H);
    canvas.style.transform = `translateX(${x}px)`;
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  async function nextPet() {
    const pets = await petList();
    const at = pets.findIndex((entry) => entry.id === pet.id);
    pet = pets[(at + 1) % pets.length];
    saved.set(pet.id);
    lastSeen = performance.now();
    set("hello", mood === "thinking" || mood === "typing" ? mood : "ready");
  }
  canvas.addEventListener("click", nextPet);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      nextPet();
    }
  });
  document.addEventListener("visibilitychange", start);
  petList().then((pets) => {
    pet = pets.find((entry) => entry.id === pet.id) || pets[0];
    paint();
  });
  paint();

  return {
    node,
    // ready, thinking (reading the files and waiting for the model), typing, done, failed
    setMood(next) {
      lastSeen = performance.now();
      set(next);
    },
    // anything the student does keeps the animal awake
    wake() {
      lastSeen = performance.now();
      if (mood === "asleep") set("ready");
      start();
    },
  };
}
