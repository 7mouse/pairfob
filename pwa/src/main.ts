import "./tailwind.css";
import "./startup.scss";
import "./shared/ui/fonts/icon-font.css";
import { startApplication } from "./app/bootstrap";

/**
 * Browser entry: styles plus one explicit lifecycle call. Hydration, the single
 * React mount, the platform listeners and the boot decision all belong to
 * `app/bootstrap.ts`.
 */
startApplication();
