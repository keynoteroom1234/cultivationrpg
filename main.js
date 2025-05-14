import './style.css';

class CultivationGame {
  constructor() {
    this.stats = {
      qi: 0,
      cultivation: 1,
      insight: 0,
      spirit: 10,
      maxSpirit: 10
    };
    
    this.costs = {
      meditate: 1,
      practice: 2,
      breakthrough: 50
    };
    
    this.log = [];
  }

  meditate() {
    if (this.stats.spirit >= this.costs.meditate) {
      this.stats.qi += this.stats.cultivation;
      this.stats.spirit -= this.costs.meditate;
      this.addLog("You meditate and gather Qi.");
    } else {
      this.addLog("Not enough spirit to meditate!");
    }
  }

  practice() {
    if (this.stats.spirit >= this.costs.practice) {
      this.stats.insight += 1;
      this.stats.spirit -= this.costs.practice;
      this.addLog("You practice your techniques.");
    } else {
      this.addLog("Not enough spirit to practice!");
    }
  }

  rest() {
    this.stats.spirit = Math.min(this.stats.spirit + 5, this.stats.maxSpirit);
    this.addLog("You rest and recover spirit.");
  }

  breakthrough() {
    if (this.stats.qi >= this.costs.breakthrough && this.stats.insight >= 10) {
      this.stats.cultivation += 1;
      this.stats.qi -= this.costs.breakthrough;
      this.stats.insight -= 10;
      this.stats.maxSpirit += 5;
      this.stats.spirit = this.stats.maxSpirit;
      this.addLog("Breakthrough achieved! Your cultivation level increases!");
    } else {
      this.addLog("Not enough Qi or Insight for breakthrough!");
    }
  }

  addLog(message) {
    this.log.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (this.log.length > 50) this.log.pop();
  }

  render() {
    return `
      <h1>Cultivation RPG</h1>
      <div class="stats">
        <div class="stat">Cultivation Level: ${this.stats.cultivation}</div>
        <div class="stat">Qi: ${this.stats.qi.toFixed(1)}</div>
        <div class="stat">Insight: ${this.stats.insight}</div>
        <div class="stat">Spirit: ${this.stats.spirit}/${this.stats.maxSpirit}</div>
      </div>
      <div class="actions">
        <button onclick="game.meditate()">Meditate (${this.costs.meditate} Spirit)</button>
        <button onclick="game.practice()">Practice (${this.costs.practice} Spirit)</button>
        <button onclick="game.rest()">Rest</button>
        <button onclick="game.breakthrough()">Breakthrough (${this.costs.breakthrough} Qi, 10 Insight)</button>
      </div>
      <div class="log">
        ${this.log.map(entry => `<div>${entry}</div>`).join('')}
      </div>
    `;
  }
}

// Initialize game and make it globally available for button clicks
window.game = new CultivationGame();

// Initial render
document.querySelector('#app').innerHTML = game.render();

// Update the display every second
setInterval(() => {
  document.querySelector('#app').innerHTML = game.render();
}, 1000);