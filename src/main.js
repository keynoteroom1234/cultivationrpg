import './style.css';
import { Game } from './game.js';

window.onload = () => {
  try { 
    Game.initializeGame(); 
  } catch (e) { 
    console.error("Initialization Error:", e); 
    if(document.body) {
      document.body.innerHTML = '<div style="color:red;padding:20px;font-size:18px;text-align:center;">A fatal error occurred during game initialization. Please check the console (F12) for details and try reloading.</div>';
    }
  }
};

// Make Game globally available
window.Game = Game;