import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { DesktopApp } from "./DesktopApp";
import { useDesktopTokenStorage } from "../lib/token";
import "../index.css";

useDesktopTokenStorage();
const root = document.getElementById("root");
if (!root) throw new Error("OFFICE renderer root missing");
createRoot(root).render(<StrictMode><Router base="/admin"><DesktopApp /></Router></StrictMode>);
