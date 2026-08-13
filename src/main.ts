import "./style.css";
import { mountRace } from "./ui/race.ts";
import { applyStoredTheme } from "./ui/themeToggle.ts";

applyStoredTheme();
mountRace();
