// --- JAVASCRIPT GAME ENGINE (BACKEND LOGIC) ---
import { 
    db, doc, setDoc, getDoc, collection, query, where, getDocs, addDoc, 
    fsServerTimestamp, runTransaction, limitToLast, onSnapshot, orderBy, generateFirestoreId
} from './firebaseService.js';
import { uiElements, modalResolve, setModalResolve as setUiModalResolve } from './ui.js'; // Import UI elements and modal resolver

// Constants for UI
const MAX_MESSAGES_IN_LOG = 15; 
const MAX_CHAT_MESSAGES_DISPLAYED = 50;

// UI Update Functions (kept here for now for easier porting, ideally move to ui.js)
function displayMessage(text, type = '') {
    try {
        const p = document.createElement('p');
        p.innerHTML = String(text).replace(/\n/g, "<br>"); 
        if (type) p.classList.add(type);
        if (uiElements.gameOutput) {
            uiElements.gameOutput.appendChild(p);
            while (uiElements.gameOutput.children.length > MAX_MESSAGES_IN_LOG) {
                uiElements.gameOutput.removeChild(uiElements.gameOutput.firstChild);
            }
            uiElements.gameOutput.scrollTop = uiElements.gameOutput.scrollHeight; 
        } else { console.error("gameOutput element not found for displayMessage:", text); }
    } catch (error) { console.error("Error in displayMessage:", error, "Original text:", text); }
}

function displayCombatAction(message, styleClass = '') {
    uiElements.combatActionText.innerHTML = ''; 
    appendCombatAction(message, styleClass); 
}

function appendCombatAction(message, styleClass = '') {
    const p = document.createElement('p');
    p.innerHTML = String(message).replace(/\n/g, "<br>");
    if (styleClass) p.classList.add(styleClass);
    uiElements.combatActionText.appendChild(p);
    uiElements.combatActionText.scrollTop = uiElements.combatActionText.scrollHeight;
}

function updateCombatUI(player, opponent) {
    if (!uiElements.combatInterface || !player || !opponent) return;
    uiElements.combatPlayerName.textContent = player.name;
    const playerHpPercent = Math.max(0, (player.health / player.maxHealth) * 100);
    uiElements.combatPlayerHbFill.style.width = `${playerHpPercent}%`;
    uiElements.combatPlayerHpText.textContent = `${player.health}/${player.maxHealth} HP`;
    uiElements.combatPlayerSprite.className = 'pixel-art-sprite player-sprite'; 
    uiElements.combatOpponentName.textContent = opponent.name;
    const opponentHpPercent = Math.max(0, (opponent.health / opponent.maxHealth) * 100);
    uiElements.combatOpponentHbFill.style.width = `${opponentHpPercent}%`;
    uiElements.combatOpponentHpText.textContent = `${opponent.health}/${opponent.maxHealth} HP`;
    uiElements.combatOpponentSprite.className = 'pixel-art-sprite monster-sprite';
}

function updateStatsDisplay(player) {
    if (!player) return;
    try {
        uiElements.statName.textContent = player.name;
        uiElements.statClass.textContent = player.chosenClassName || "Undetermined";
        uiElements.statRealm.textContent = player.getCultivationRealmName(); 
        uiElements.statLevel.textContent = player.cultivationLevel;
        uiElements.statSpiritualRoot.textContent = player.spiritualRootName || "Undetermined"; 
        uiElements.statProgress.textContent = `${player.cultivationProgress}/${player.getXPForNextLevel()} XP`; 
        uiElements.statHealth.textContent = `${player.health}/${player.maxHealth}`;
        uiElements.statQi.textContent = `${player.currentQi}/${player.maxQi}`; 
        uiElements.statAttack.textContent = player.getTotalAttack(); 
        uiElements.statDefense.textContent = player.defense; 
        uiElements.statSpiritStones.textContent = player.resources.spiritStones !== undefined ? player.resources.spiritStones : 0;
        uiElements.statSect.textContent = player.sectId && Game.sects[player.sectId] ? Game.sects[player.sectId].name : "None";
        uiElements.statWeapon.textContent = player.equippedWeapon ? Game.ITEM_DATA[player.equippedWeapon].name : "Unarmed";

        if (player.chosenClassKey === 'demon_cultivator' && player.demonicCorruption > 0) {
            uiElements.statDemonicCorruption.textContent = player.demonicCorruption;
            uiElements.statDemonicCorruptionContainer.style.display = 'block';
        } else {
            uiElements.statDemonicCorruptionContainer.style.display = 'none';
        }
    } catch (error) { console.error("Error updating stats display:", error); displayMessage("Error updating player stats.", "error");}
}

function populateModalInventoryGrid(player) {
    if (!uiElements.modalInventoryGridContainer) {
        console.error("Modal inventory grid container not found!");
        return;
    }
    uiElements.modalInventoryGridContainer.innerHTML = ''; 

    if (!player || !player.resources) {
        const emptySlot = document.createElement('div');
        emptySlot.classList.add('inventory-slot');
        const nameDiv = document.createElement('div');
        nameDiv.classList.add('inventory-slot-name');
        nameDiv.textContent = 'N/A';
        emptySlot.appendChild(nameDiv);
        uiElements.modalInventoryGridContainer.appendChild(emptySlot);
        return;
    }

    const itemsToDisplay = [];
    const sortedItemKeys = Object.keys(player.resources).sort((a, b) => {
        const itemA = Game.ITEM_DATA[a];
        const itemB = Game.ITEM_DATA[b];
        if (!itemA || !itemB) return 0;
        return (itemA.name || a).localeCompare(itemB.name || b);
    });

    for (const itemKey of sortedItemKeys) {
        if (player.resources[itemKey] > 0 && Game.ITEM_DATA[itemKey] && Game.ITEM_DATA[itemKey].type !== 'currency') {
            itemsToDisplay.push({ key: itemKey, quantity: player.resources[itemKey], data: Game.ITEM_DATA[itemKey] });
        }
    }

    const totalSlots = player.maxInventorySlots || 50; 

    for (let i = 0; i < totalSlots; i++) {
        const slotDiv = document.createElement('div');
        slotDiv.classList.add('inventory-slot');

        if (i < itemsToDisplay.length) {
            const item = itemsToDisplay[i];
            slotDiv.classList.add('has-item');
            slotDiv.title = `${item.data.name} (x${item.quantity})\n${item.data.description || ''}`;

            const iconDiv = document.createElement('div');
            iconDiv.classList.add('inventory-slot-icon');
            
            if (item.data.gameAsset) {
                iconDiv.style.backgroundImage = `url('/assets/${item.data.gameAsset}')`; // UPDATED PATH
                iconDiv.textContent = ''; 
                iconDiv.style.backgroundSize = 'contain'; 
                iconDiv.style.backgroundRepeat = 'no-repeat';
                iconDiv.style.backgroundPosition = 'center';
            } else if (item.data.iconChar) { 
                iconDiv.style.backgroundImage = 'none'; 
                iconDiv.textContent = item.data.iconChar;
            } else { 
                iconDiv.style.backgroundImage = 'none'; 
                iconDiv.textContent = item.data.name ? item.data.name.substring(0, 1).toUpperCase() : '?';
            }
            slotDiv.appendChild(iconDiv);

            const nameDiv = document.createElement('div');
            nameDiv.classList.add('inventory-slot-name');
            nameDiv.textContent = item.data.name || 'Unknown Item';
            slotDiv.appendChild(nameDiv);

            if (item.quantity > 0) { 
                const quantityDiv = document.createElement('div');
                quantityDiv.classList.add('inventory-slot-quantity');
                quantityDiv.textContent = `x${item.quantity}`;
                slotDiv.appendChild(quantityDiv);
            }

            slotDiv.onclick = () => {
                if (item.data.type === 'consumable' || item.data.type === 'weapon' || item.data.type === 'recipe') {
                    Game.useItem(item.key); 
                } else {
                    displayMessage(`${item.data.name}: ${item.data.description || 'This item cannot be used directly from here.'}`, 'narration');
                }
            };
        }
        uiElements.modalInventoryGridContainer.appendChild(slotDiv);
    }
    if (itemsToDisplay.length === 0 && totalSlots > 0) {
        const firstSlot = uiElements.modalInventoryGridContainer.querySelector('.inventory-slot');
        if (firstSlot) {
            firstSlot.innerHTML = ''; 
            const emptyText = document.createElement('div');
            emptyText.classList.add('inventory-slot-name');
            emptyText.textContent = 'Empty';
            emptyText.style.fontSize = '0.8em'; 
            emptyText.style.color = '#a0aec0'; 
            firstSlot.appendChild(emptyText);
            firstSlot.style.justifyContent = 'center'; 
        }
    }
}

function populateActionButtons(choices, containerElement) {
    containerElement.innerHTML = ''; 
    try {
        if (choices && choices.length > 0) {
            choices.forEach(choice => {
                const button = document.createElement('button');
                button.textContent = choice.text;
                button.classList.add('action-button', 'text-white', 'font-semibold', 'py-2', 'px-4', 'rounded-lg', 'shadow-md', 'm-1');
                let styleClass = 'bg-blue-600 hover:bg-blue-700'; 
                if (choice.style === 'danger') styleClass = 'bg-red-600 hover:bg-red-700';
                else if (choice.style === 'confirm') styleClass = 'bg-green-600 hover:bg-green-700';
                else if (choice.style === 'neutral') styleClass = 'bg-gray-600 hover:bg-gray-700';
                else if (choice.style === 'special') styleClass = 'bg-purple-600 hover:bg-purple-700';
                else if (choice.style === 'divine') styleClass = 'bg-pink-600 hover:bg-pink-700'; 
                else if (choice.style === 'class_select') styleClass = 'bg-teal-600 hover:bg-teal-700'; 
                else if (choice.style === 'inventory_item_original') styleClass = 'bg-indigo-600 hover:bg-indigo-700 inventory-item-button';
                else if (choice.style === 'market_action') styleClass = 'bg-yellow-500 hover:bg-yellow-600 text-gray-900'; 
                else if (choice.style === 'crafting_action') styleClass = 'bg-lime-600 hover:bg-lime-700 text-gray-900 concoction-recipe-button'; 
                button.classList.add(...styleClass.split(' '));
                
                if (choice.action === 'show_class_info') {
                    button.onclick = () => Game.showClassInfo(choice.value);
                } else if (choice.action === 'use_item') { 
                    button.onclick = () => Game.useItem(choice.value);
                } else if (choice.action === 'list_item_for_sale_prompt') {
                    button.onclick = () => Game.promptListItemForSale(choice.value);
                } else if (choice.action === 'prompt_concoct_quantity') { 
                    button.onclick = () => Game.promptConcoctQuantity(choice.value);
                }
                else {
                    button.onclick = () => Game.handlePlayerChoice(choice.action, choice.value);
                }
                containerElement.appendChild(button);
            });
        }
    } catch (error) { console.error("Error populating action buttons:", error); displayMessage("Error displaying choices.", "error");}
}

function getModalInput(promptText, type = 'text') {
    return new Promise((resolve) => {
        try {
            if (!uiElements.inputModal || !uiElements.modalPrompt || !uiElements.modalInputField || !uiElements.modalPasswordInputField) {
                console.error("Modal DOM elements not found!"); displayMessage("Error: UI input missing.", "error"); resolve(null); return;
            }
            uiElements.modalPrompt.textContent = promptText;
            uiElements.modalInputField.value = ''; uiElements.modalPasswordInputField.value = ''; 
            if (type === 'password') {
                uiElements.modalInputField.style.display = 'none'; uiElements.modalPasswordInputField.style.display = 'block'; uiElements.modalPasswordInputField.focus();
            } else { 
                uiElements.modalInputField.style.display = 'block'; uiElements.modalPasswordInputField.style.display = 'none'; uiElements.modalInputField.type = type; uiElements.modalInputField.focus();
            }
            uiElements.inputModal.style.display = 'flex'; 
            setUiModalResolve(resolve); // Use the imported setter
        } catch (error) { console.error("Error in getModalInput:", error); displayMessage("Error preparing input.", "error"); resolve(null); }
    });
}

// Chat UI Functions
function displayChatMessage(messageData) {
    if (!uiElements.chatLogContainer || !Game.currentPlayerId) return;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message');

    const senderNameSpan = document.createElement('span');
    senderNameSpan.classList.add('sender-name');
    senderNameSpan.textContent = `${messageData.senderName}:`; 

    const messageTextSpan = document.createElement('span');
    messageTextSpan.classList.add('message-text');
    messageTextSpan.textContent = ` ${messageData.text}`; 

    messageDiv.appendChild(senderNameSpan);
    messageDiv.appendChild(messageTextSpan);

    if (messageData.timestamp && messageData.timestamp.toDate) { 
        const timestampSpan = document.createElement('span');
        timestampSpan.classList.add('timestamp');
        timestampSpan.textContent = `(${new Date(messageData.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
        messageDiv.appendChild(timestampSpan);
    }

    if (messageData.senderId === Game.currentPlayerId) {
        messageDiv.classList.add('my-message');
    } else {
        messageDiv.classList.add('other-message');
    }

    uiElements.chatLogContainer.appendChild(messageDiv);
    uiElements.chatLogContainer.scrollTop = uiElements.chatLogContainer.scrollHeight;
}


function toCamelCase(str) {
    if (!str) return '';
    let cleanedStr = str.replace(/[^a-zA-Z0-9\s]/g, '');
    return cleanedStr.toLowerCase()
        .replace(/\s+(.)/g, (match, chr) => chr.toUpperCase())
        .replace(/\s/g, '') 
        .replace(/^(.)/, (match, chr) => chr.toLowerCase());
}

class Character {
    constructor(name, health, attack, defense, cultivationLevel = 0) {
        this.name = name;
        this.maxHealth = health;
        this.health = health;
        this.attack = attack; 
        this.defense = defense; 
        this.cultivationLevel = cultivationLevel;
        this.cultivationProgress = 0;
    }
    isAlive() { return this.health > 0; }

    takeDamage(damage) { 
        const actualDamage = Math.max(0, damage - this.defense); 
        this.health -= actualDamage;
        let message = `${this.name} takes <strong class="text-yellow-300">${actualDamage}</strong> damage. (HP: ${this.health}/${this.maxHealth})`;
        if (!this.isAlive()) { message += ` ${this.name} has been defeated!`; }
        
        const messageStyle = (this instanceof Player) ? 'combat-text-opponent-action' : 'combat-text-player-action';
        if (Game.currentCombat) { 
           updateCombatUI(Game.players[Game.currentPlayerId], Game.currentCombat.opponent); 
        }
        return { actualDamage: actualDamage, message: message, style: messageStyle }; 
    }

    attackTarget(target) { 
        if (!this.isAlive()) return;
        
        const attackMessageStyle = (this instanceof Player) ? 'combat-text-player-action' : 'combat-text-opponent-action';
        const totalAttack = (this instanceof Player) ? this.getTotalAttack() : this.attack; 

        displayCombatAction(`${this.name} attacks ${target.name}!`, attackMessageStyle); 
        
        const baseDamage = totalAttack;
        const damageVariance = Math.floor(totalAttack / 5);
        const damage = baseDamage + (Math.floor(Math.random() * (damageVariance * 2 + 1)) - damageVariance);
        
        const damageResult = target.takeDamage(damage); 
        appendCombatAction(damageResult.message, damageResult.style); 
    }

    getCultivationRealmName() {
        const realms = ["Mortal", "Qi Condensation", "Foundation Establishment", "Core Formation", "Nascent Soul", "Soul Formation", "Transcendent"]; 
        if (this.cultivationLevel === 0) return realms[0]; 
        if (this.cultivationLevel >= 46) return realms[6]; // Transcendent (Level 46+)
        if (this.cultivationLevel >= 37) return realms[5]; // Soul Formation (Level 37-45)
        if (this.cultivationLevel >= 28) return realms[4]; // Nascent Soul (Level 28-36)
        if (this.cultivationLevel >= 19) return realms[3]; // Core Formation (Level 19-27)
        if (this.cultivationLevel >= 10) return realms[2]; // Foundation Establishment (Level 10-18)
        
        const qiCondensationStage = (this.cultivationLevel - 1) % 9 + 1;
        return `${realms[1]} Stage ${qiCondensationStage}`;
    }

    getXPForNextLevel() { return (this.cultivationLevel + 1) * 100; }
    
    gainCultivationXP(xp) {
        if (!this.isAlive()) return;
    
        if (this instanceof Player && this.isAtMajorBreakthrough()) {
            const requiredPillName = this.getRequiredBreakthroughPillName();
            displayMessage(`You are at the peak of ${this.getCultivationRealmName()} and require a <span class="important">${requiredPillName}</span>. You are not gaining further experience.`, 'system');
            if (this instanceof Player) { 
                updateStatsDisplay(this); 
                Game.saveCurrentPlayerState(); 
            }
            return; 
        }
    
        const finalXp = Math.floor(xp * (this.spiritualRootMultiplier || 1));
        let gainedEffectiveXP = finalXp;
    
        if (this instanceof Player) {
            const player = this;
            const levelBeforePotentialGain = player.cultivationLevel;
            const progressBeforePotentialGain = player.cultivationProgress;
            const xpToNextLevelBeforeGain = player.getXPForNextLevel();
    
            const isCurrentlyAtBreakthroughLevelButNotFull = (
                (levelBeforePotentialGain === 9 || levelBeforePotentialGain === 18 || levelBeforePotentialGain === 27 || levelBeforePotentialGain === 36 || levelBeforePotentialGain === 45) &&
                progressBeforePotentialGain < xpToNextLevelBeforeGain 
            );
    
            if (isCurrentlyAtBreakthroughLevelButNotFull) {
                const xpCanStillGain = xpToNextLevelBeforeGain - progressBeforePotentialGain;
                if (finalXp > xpCanStillGain) {
                    gainedEffectiveXP = xpCanStillGain; 
                    player.cultivationProgress += gainedEffectiveXP; 
                    displayMessage(`${player.name} gained ${gainedEffectiveXP} cultivation experience.`, 'success');
                    
                    const requiredPillName = player.getRequiredBreakthroughPillName(); 
                    displayMessage(`You have reached the peak of ${player.getCultivationRealmName()}. You require a <span class="important">${requiredPillName}</span> to break through!`, 'system');
                    displayMessage(`You are no longer gaining cultivation experience until you break through.`, 'system');
                    
                    updateStatsDisplay(player); 
                    Game.saveCurrentPlayerState();
                    return; 
                }
            }
        }
        
        this.cultivationProgress += gainedEffectiveXP; 
        if (gainedEffectiveXP > 0) {
            displayMessage(`${this.name} gained ${gainedEffectiveXP} cultivation experience.`, 'success'); 
        }
    
        while (this.cultivationProgress >= this.getXPForNextLevel() && this.isAlive()) {
            this.cultivationProgress -= this.getXPForNextLevel();
            this.cultivationLevel += 1; 
            this.maxHealth += 20; 
            this.health = this.maxHealth;
            this.attack += 2; 
            this.defense += 1; 
            if (this instanceof Player) {
                this.maxQi += 10;
                this.currentQi = Math.min(this.maxQi, this.currentQi + 10); 
            }
            displayMessage(`Congratulations! ${this.name} has reached ${this.getCultivationRealmName()}!`, 'important');
    
            if (this instanceof Player) {
                const player = this;
                const currentLevel = player.cultivationLevel;
                const isMajorBreakthroughLevel = (currentLevel === 9 || currentLevel === 18 || currentLevel === 27 || currentLevel === 36 || currentLevel === 45);
                
                if (isMajorBreakthroughLevel) {
                    player.cultivationProgress = player.getXPForNextLevel(); 
                    const requiredPillName = player.getRequiredBreakthroughPillName(); 
                    displayMessage(`You have reached the peak of ${player.getCultivationRealmName()}. You require a <span class="important">${requiredPillName}</span> to break through!`, 'system');
                    displayMessage(`You are no longer gaining cultivation experience until you break through.`, 'system');
                    
                    updateStatsDisplay(player); 
                    Game.saveCurrentPlayerState();
                    return; 
                }
            }
        }
    
        if (this instanceof Player) {
            updateStatsDisplay(this); 
            Game.saveCurrentPlayerState(); 
        }
    }
}

class Player extends Character {
    constructor(username, password, name) {
        super(name, 100, 10, 5, 1); 
        this.username = username; this.password = password; 
        this.playerId = generateFirestoreId("players"); // Use helper for client-side ID
        this.sectId = null; 
        this.maxInventorySlots = 50; 
        this.resources = { 
            commonHerbs: 0, roughIronOre: 0, blankTalismanPaper: 0,
            monsterCoreWeak: 0, beastBoneFragment: 0, spiritDust: 0,
            spiritStoneFragment: 0, spiritStones: 0, 
            minorHealingPill: 0, minorQiPill: 0,
            roughSword: 0, minorFireTalisman: 0,
            jadeleafGrass: 0, crimsonSpiritBerry: 0, soothingRainPetal: 0,
            moondewFlower: 0, earthrootGinseng: 0, skyLotusBud: 0,
            whisperingLeaf: 0, radiantSunfruit: 0, cloudmossVine: 0,
            spiritglowMushroom: 0,
            breakthroughVine: 0, dragonboneFern: 0, phoenixbloodHerb: 0,
            ascensionOrchid: 0, heavenpierceRoot: 0, divineFlameGrass: 0,
            lunarBloom: 0, immortalDustleaf: 0, voidberryThorn: 0,
            thunderclapFruit: 0,
            starforgePetal: 0, stoneheartRoot: 0, spiritEyeFlower: 0, heartblossomBud: 0,
            silverstormLeaf: 0, goldenDantianFruit: 0, blackflameGinseng: 0, frostmarrowMoss: 0,
            harmonizingBellvine: 0, eyeOfTheAncients: 0
        };
        this.spiritualRootName = "Undetermined"; 
        this.spiritualRootMultiplier = 1;      
        this.hasRolledSpiritualRoot = false;   
        this.chosenClassName = "Undetermined";
        this.chosenClassKey = null;
        this.hasClassChosen = false;
        this.maxQi = 50; 
        this.currentQi = this.maxQi; 
        this.demonicCorruption = 0;
        this.equippedWeapon = null; 
        this.weaponAttackBonus = 0;
        this.knownRecipes = []; 
    }
    getTotalAttack() {
        return this.attack + this.weaponAttackBonus;
    }

    isAtMajorBreakthrough() {
        const xpNeededForNext = this.getXPForNextLevel();
        if (this.cultivationProgress < xpNeededForNext) return false; 

        const level = this.cultivationLevel;
        return (level === 9 || level === 18 || level === 27 || level === 36 || level === 45);
    }

    getRequiredBreakthroughPillName() {
        if (this.cultivationLevel === 9) return "Foundation Establishment Pill";
        if (this.cultivationLevel === 18) return "Golden Core Nine Revolutions Pill";
        if (this.cultivationLevel === 27) return "Nascent Soul Unification Pill";
        if (this.cultivationLevel === 36) return "Soul Formation Heaven Pill";
        if (this.cultivationLevel === 45) return "Transcendence Void Elixir";
        return null; 
    }
    
    _performMajorBreakthrough(newCultivationLevel, newRealmShortName) {
        this.cultivationProgress = 0; 
        this.cultivationLevel = newCultivationLevel; 

        this.maxHealth += 20;
        this.attack += 2;
        this.defense += 1;
        this.maxQi += 10;

        this.maxHealth += 50;
        this.attack += 5;
        this.defense += 3;
        this.maxQi += 25;

        this.health = this.maxHealth; 
        this.currentQi = this.maxQi; 

        this.maxInventorySlots = (this.maxInventorySlots || 50) + 50;
        displayMessage(`Your inventory capacity has expanded to <span class="important">${this.maxInventorySlots}</span> slots!`, 'success');

        displayMessage(`The pill surges through you! You have broken through to the <span class="important">${newRealmShortName}</span> realm!`, 'important');
        displayMessage(`Congratulations! ${this.name} has reached ${this.getCultivationRealmName()}!`, 'important'); 
    }

    meditate() {
        if (!this.isAlive()) { displayMessage("Cannot meditate while defeated.", 'error'); Game.showLoggedInMenu(); return; }
        displayMessage(`\n${this.name} enters a meditative state...`, 'narration');
        
        let healthRecoveryPercent = 0.25; 
        let qiRecoveryPercent = 0.25; 

        if (this.chosenClassKey === 'qi_cultivator') {
            qiRecoveryPercent = 0.35; 
            healthRecoveryPercent = 0.30; 
            displayMessage("Your affinity for Qi enhances your meditation.", 'class-info');
        }
        
        const healthRecovered = Math.floor(this.maxHealth * healthRecoveryPercent);
        const qiRecovered = Math.floor(this.maxQi * qiRecoveryPercent);

        this.health = Math.min(this.maxHealth, this.health + healthRecovered);
        this.currentQi = Math.min(this.maxQi, this.currentQi + qiRecovered);

        displayMessage(`Health recovered by ${healthRecovered}. Current Health: ${this.health}/${this.maxHealth}`, 'success');
        displayMessage(`Spiritual Energy (QI) recovered by ${qiRecovered}. Current QI: ${this.currentQi}/${this.maxQi}`, 'qi-recovery');
        
        updateStatsDisplay(this);
        Game.saveCurrentPlayerState(); 
        Game.showLoggedInMenu();
    }
    toFirestoreObject() {
        const defaultResources = {
            commonHerbs: 0, roughIronOre: 0, blankTalismanPaper: 0,
            monsterCoreWeak: 0, beastBoneFragment: 0, spiritDust: 0,
            spiritStoneFragment: 0, spiritStones: 0,
            minorHealingPill: 0, minorQiPill: 0,
            roughSword: 0, minorFireTalisman: 0,
            jadeleafGrass: 0, crimsonSpiritBerry: 0, soothingRainPetal: 0,
            moondewFlower: 0, earthrootGinseng: 0, skyLotusBud: 0,
            whisperingLeaf: 0, radiantSunfruit: 0, cloudmossVine: 0,
            spiritglowMushroom: 0,
            breakthroughVine: 0, dragonboneFern: 0, phoenixbloodHerb: 0,
            ascensionOrchid: 0, heavenpierceRoot: 0, divineFlameGrass: 0,
            lunarBloom: 0, immortalDustleaf: 0, voidberryThorn: 0,
            thunderclapFruit: 0,
            starforgePetal: 0, stoneheartRoot: 0, spiritEyeFlower: 0, heartblossomBud: 0,
            silverstormLeaf: 0, goldenDantianFruit: 0, blackflameGinseng: 0, frostmarrowMoss: 0,
            harmonizingBellvine: 0, eyeOfTheAncients: 0
        };
        for (const recipeKey in Game.PILL_RECIPES) {
            const pillItemKey = Game.PILL_RECIPES[recipeKey].producesItemKey;
            if (!defaultResources.hasOwnProperty(pillItemKey)) {
                defaultResources[pillItemKey] = 0;
            }
            const recipeItemKeyForPill = toCamelCase(Game.PILL_RECIPES[recipeKey].name) + "Recipe";
             if (!Game.PILL_RECIPES[recipeKey].isBasic && !defaultResources.hasOwnProperty(recipeItemKeyForPill)) {
                defaultResources[recipeItemKeyForPill] = 0;
            }
        }
        const resourcesToSave = { ...defaultResources, ...this.resources };
        return {
            username: this.username, password: this.password, name: this.name, playerId: this.playerId,
            maxHealth: this.maxHealth, health: this.health, attack: this.attack, defense: this.defense,
            cultivationLevel: this.cultivationLevel, cultivationProgress: this.cultivationProgress,
            sectId: this.sectId, 
            maxInventorySlots: this.maxInventorySlots, 
            resources: resourcesToSave, 
            spiritualRootName: this.spiritualRootName,
            spiritualRootMultiplier: this.spiritualRootMultiplier, hasRolledSpiritualRoot: this.hasRolledSpiritualRoot,
            chosenClassName: this.chosenClassName, chosenClassKey: this.chosenClassKey,
            hasClassChosen: this.hasClassChosen, maxQi: this.maxQi, currentQi: this.currentQi,
            demonicCorruption: this.demonicCorruption,
            equippedWeapon: this.equippedWeapon, weaponAttackBonus: this.weaponAttackBonus,
            knownRecipes: this.knownRecipes || []
        };
    }
    static fromFirestoreObject(docData) {
        const player = new Player(docData.username, docData.password, docData.name);
        const defaultResources = {
            commonHerbs: 0, roughIronOre: 0, blankTalismanPaper: 0,
            monsterCoreWeak: 0, beastBoneFragment: 0, spiritDust: 0,
            spiritStoneFragment: 0, spiritStones: 0,
            minorHealingPill: 0, minorQiPill: 0,
            roughSword: 0, minorFireTalisman: 0,
            jadeleafGrass: 0, crimsonSpiritBerry: 0, soothingRainPetal: 0,
            moondewFlower: 0, earthrootGinseng: 0, skyLotusBud: 0,
            whisperingLeaf: 0, radiantSunfruit: 0, cloudmossVine: 0,
            spiritglowMushroom: 0,
            breakthroughVine: 0, dragonboneFern: 0, phoenixbloodHerb: 0,
            ascensionOrchid: 0, heavenpierceRoot: 0, divineFlameGrass: 0,
            lunarBloom: 0, immortalDustleaf: 0, voidberryThorn: 0,
            thunderclapFruit: 0,
            starforgePetal: 0, stoneheartRoot: 0, spiritEyeFlower: 0, heartblossomBud: 0,
            silverstormLeaf: 0, goldenDantianFruit: 0, blackflameGinseng: 0, frostmarrowMoss: 0,
            harmonizingBellvine: 0, eyeOfTheAncients: 0
        };
        for (const recipeKey in Game.PILL_RECIPES) {
            const pillItemKey = Game.PILL_RECIPES[recipeKey].producesItemKey;
            if (!defaultResources.hasOwnProperty(pillItemKey)) {
                defaultResources[pillItemKey] = 0;
            }
             const recipeItemKeyForPill = toCamelCase(Game.PILL_RECIPES[recipeKey].name) + "Recipe";
             if (!Game.PILL_RECIPES[recipeKey].isBasic && !defaultResources.hasOwnProperty(recipeItemKeyForPill)) {
                defaultResources[recipeItemKeyForPill] = 0;
            }
        }
        const resourcesFromDb = docData.resources || {};
        Object.assign(player, {
            ...docData,
            maxInventorySlots: docData.maxInventorySlots || 50, 
            resources: { ...defaultResources, ...resourcesFromDb },
            knownRecipes: docData.knownRecipes || []
        });
        for (const key in player.resources) {
            player.resources[key] = Number(player.resources[key]) || 0;
        }
        player.demonicCorruption = Number(player.demonicCorruption) || 0;
        player.weaponAttackBonus = Number(player.weaponAttackBonus) || 0;
        return player;
    }
    joinSect(sectId) {
        if (Game.sects[sectId]) {
            if (this.sectId) { displayMessage(`Already in ${Game.sects[this.sectId].name}.`, 'error'); return; }
            Game.sects[sectId].addMember(this.playerId); this.sectId = sectId;
            displayMessage(`Joined ${Game.sects[sectId].name}!`, 'success');
        } else { displayMessage("Sect not found.", 'error'); }
        updateStatsDisplay(this);
        Game.saveCurrentPlayerState();
    }
    leaveSect() {
        if (this.sectId && Game.sects[this.sectId]) {
            const sectName = Game.sects[this.sectId].name;
            Game.sects[this.sectId].removeMember(this.playerId); this.sectId = null;
            displayMessage(`Left ${sectName}.`, 'narration');
        } else { displayMessage("Not in a sect.", 'error'); }
        updateStatsDisplay(this);
        Game.saveCurrentPlayerState();
    }
}

class Monster extends Character {
    constructor(name, health, attack, defense, cultivationLevel, xpReward, tamable = false) { 
        super(name, health, attack, defense, cultivationLevel); 
        this.xpReward = xpReward;
        this.spiritualRootMultiplier = 1; 
        this.tamable = tamable; 
    }
    getCultivationRealmName() { 
        if (this.cultivationLevel < 5) return "Weak Beast";
        if (this.cultivationLevel < 15) return "Fierce Beast";
        if (this.cultivationLevel < 25) return "Demonic Beast";
        if (this.cultivationLevel < 35) return "Spirit Beast";
        return "Ancient Terror";
    }
    getLootDrops(player) {
        let loot = [];
        const playerRealmTier = Game.getRealmTier(player.cultivationLevel);

        if (Math.random() < 0.7) { 
            const stonesFound = Math.floor(Math.random() * (playerRealmTier * 2)) + playerRealmTier; 
            loot.push({itemId: 'spiritStones', quantity: stonesFound});
        }
        if (Math.random() < 0.5) { loot.push({itemId: 'spiritStoneFragment', quantity: 1});}
        if (Math.random() < 0.25) { loot.push({itemId: 'monsterCoreWeak', quantity: 1});}
        if (Math.random() < 0.15 && playerRealmTier > 1) { loot.push({itemId: 'beastBoneFragment', quantity: 1});}

        const potentialHerbDrops = Game.REALM_HERB_DROPS[playerRealmTier] || [];
        if (Math.random() < 0.65) { 
            potentialHerbDrops.forEach(herbDrop => {
                let effectiveChance = herbDrop.chance;
                if (Game.ITEM_DATA[herbDrop.itemId] && Game.ITEM_DATA[herbDrop.itemId].forRealmBreak) {
                    const targetBreakTier = Game.ITEM_DATA[herbDrop.itemId].forRealmBreak;
                    if (targetBreakTier === playerRealmTier + 1) effectiveChance *= 1.2; 
                    else if (targetBreakTier <= playerRealmTier) effectiveChance *= 0.4;
                }
                if (Math.random() < effectiveChance) {
                    const quantity = Math.floor(Math.random() * (herbDrop.maxQuantity - herbDrop.minQuantity + 1)) + herbDrop.minQuantity;
                    loot.push({itemId: herbDrop.itemId, quantity: quantity});
                }
            });
        }

        if (Math.random() < 0.12) { 
            const allRecipeItemKeys = Object.keys(Game.ITEM_DATA).filter(k => Game.ITEM_DATA[k].type === 'recipe');
            const eligibleRecipes = allRecipeItemKeys.filter(recipeItemKey => {
                const recipeKey = Game.ITEM_DATA[recipeItemKey].learnsRecipeKey;
                const pillRecipe = Game.PILL_RECIPES[recipeKey];
                return player.cultivationLevel >= (pillRecipe.requiredCultivationLevel - 8) && player.cultivationLevel <= (pillRecipe.requiredCultivationLevel + 8);
            });

            if (eligibleRecipes.length > 0) {
                const randomRecipeItemKey = eligibleRecipes[Math.floor(Math.random() * eligibleRecipes.length)];
                 loot.push({itemId: randomRecipeItemKey, quantity: 1});
            }
        }
        return loot;
    }
}

class Sect {
    constructor(name, founderId, description = "A mysterious sect.") {
        this.sectId = generateFirestoreId("sects"); this.name = name; this.founderId = founderId; // Use helper
        this.description = description; this.members = new Set([founderId]); this.sectPower = 0; 
    }
    addMember(playerId) {
        this.members.add(playerId);
        const playerName = Game.players[playerId] ? Game.players[playerId].name : "A new cultivator";
        displayMessage(`${playerName} has joined the ${this.name} sect!`, 'success'); 
        this.updateSectPower();
    }
    removeMember(playerId) {
        if (this.members.has(playerId)) {
            const memberName = Game.players[playerId] ? Game.players[playerId].name : "A member";
            this.members.delete(playerId); displayMessage(`${memberName} left sect.`, 'narration');
            this.updateSectPower();
            if (this.members.size === 0) {
                displayMessage(`Sect ${this.name} disbanded.`, 'important'); delete Game.sects[this.sectId];
            }
        }
    }
    updateSectPower() { /* Placeholder */ }
}

export const Game = {
    players: {}, sects: {}, currentPlayerId: null, currentCombat: null, currentGameState: 'MAIN_GATE', 
    selectedClassForInfo: null, 
    tempTransactionData: null, 
    PILL_RECIPES: {}, 
    chatMessagesListener: null,

    ITEM_DATA: {
        "commonHerbs": { name: "Common Herbs", description: "Basic herbs for alchemy.", type: "material", tier: 1, gameAsset: 'herb.png' },
        "roughIronOre": { name: "Rough Iron Ore", description: "Unrefined ore for forging.", type: "material", tier: 1, gameAsset: 'stone.png' },
        "blankTalismanPaper": { name: "Blank Talisman Paper", description: "Paper for drawing talismans.", type: "material", tier: 1, gameAsset: 'stone.png' }, // Assuming stone.png placeholder for paper
        "monsterCoreWeak": { name: "Monster Core (Weak)", description: "A weak core from a defeated monster.", type: "material", tier: 1, gameAsset: 'stone.png' }, // Placeholder
        "beastBoneFragment": { name: "Beast Bone Fragment", description: "A fragment of a beast's bone.", type: "material", tier: 2, gameAsset: 'stone.png' }, // Placeholder
        "spiritDust": { name: "Spirit Dust", description: "Residue with faint spiritual energy.", type: "material", tier: 2, gameAsset: 'stone.png' }, // Placeholder
        "spiritStoneFragment": { name: "Spirit Stone Fragment", description: "A small piece of a spirit stone.", type: "material", tier: 1, gameAsset: 'stone.png' },
        "spiritStones": { name: "Spirit Stones", description: "Currency of the cultivation world.", type: "currency", gameAsset: 'stone.png' }, // Placeholder
        
        "minorHealingPill": { name: "Minor Healing Pill", description: "Restores a small amount of health.", type: "consumable", gameAsset: 'elixir.png', effect: (player) => { const heal = 25; player.health = Math.min(player.maxHealth, player.health + heal); displayMessage(`Used Minor Healing Pill. Restored ${heal} HP.`, "item-use"); player.resources.minorHealingPill--; updateStatsDisplay(player); Game.saveCurrentPlayerState();}, usableInCombat: true },
        "minorQiPill": { name: "Minor QI Pill", description: "Restores a small amount of QI.", type: "consumable", gameAsset: 'elixir.png', effect: (player) => { const qiRestore = 20; player.currentQi = Math.min(player.maxQi, player.currentQi + qiRestore); displayMessage(`Used Minor QI Pill. Restored ${qiRestore} QI.`, "item-use"); player.resources.minorQiPill--; updateStatsDisplay(player); Game.saveCurrentPlayerState();}, usableInCombat: true },
        "roughSword": { name: "Rough Sword", description: "A crudely made sword. Attack +5.", type: "weapon", attackBonus: 5, gameAsset: 'stone.png', equipEffect: (player) => { player.equippedWeapon = "roughSword"; player.weaponAttackBonus = 5; displayMessage("Equipped Rough Sword.", "item-use"); updateStatsDisplay(player); Game.saveCurrentPlayerState(); } }, // Placeholder
        "minorFireTalisman": { name: "Minor Fire Talisman", description: "Unleashes a small burst of fire. (10 QI)", type: "talisman", qiCost: 10, damage: 15, gameAsset: 'stone.png', effectInCombat: (player, opponent) => { if (player.currentQi >= 10) { player.currentQi -= 10; displayCombatAction(`${player.name} uses a Minor Fire Talisman!`, "combat-text-player-action"); const damageResult = opponent.takeDamage(15); appendCombatAction(damageResult.message, damageResult.style); updateStatsDisplay(player); Game.saveCurrentPlayerState(); return true;} else { appendCombatAction("Not enough QI to use Fire Talisman!", "error"); return false;} } }, // Placeholder

        "jadeleafGrass": { name: "Jadeleaf Grass", description: "Common herb that mildly restores qi.", type: "material", tier: 1, gameAsset: 'herb.png' },
        "crimsonSpiritBerry": { name: "Crimson Spirit Berry", description: "Used for blood regeneration and minor injuries.", type: "material", tier: 1, gameAsset: 'herb.png' },
        "soothingRainPetal": { name: "Soothing Rain Petal", description: "Calms qi deviation; heals minor spiritual wounds.", type: "material", tier: 2, gameAsset: 'herb.png' },
        "moondewFlower": { name: "Moondew Flower", description: "A gentle restorative for mind and body.", type: "material", tier: 2, gameAsset: 'herb.png' },
        "earthrootGinseng": { name: "Earthroot Ginseng", description: "Recovers qi and physical stamina.", type: "material", tier: 3, gameAsset: 'herb.png' },
        "skyLotusBud": { name: "Sky Lotus Bud", description: "Advanced qi restoration, often used by Core cultivators.", type: "material", tier: 4, gameAsset: 'herb.png' },
        "whisperingLeaf": { name: "Whispering Leaf", description: "Promotes faster energy circulation during rest.", type: "material", tier: 3, gameAsset: 'herb.png' },
        "radiantSunfruit": { name: "Radiant Sunfruit", description: "Restores both qi and vitality rapidly.", type: "material", tier: 4, gameAsset: 'herb.png' },
        "cloudmossVine": { name: "Cloudmoss Vine", description: "Stimulates spiritual veins; best for Nascent Soul users.", type: "material", tier: 5, gameAsset: 'herb.png' },
        "spiritglowMushroom": { name: "Spiritglow Mushroom", description: "Heals internal meridian damage.", type: "material", tier: 5, isRare: true, gameAsset: 'herb.png' },

        "breakthroughVine": { name: "Breakthrough Vine", description: "Helps cultivators leap into Foundation Establishment.", type: "material", tier: 1, isRare: true, forRealmBreak: 2, gameAsset: 'herb.png' }, 
        "dragonboneFern": { name: "Dragonbone Fern", description: "Used in pills to stabilize Core Formation.", type: "material", tier: 2, isRare: true, forRealmBreak: 3, gameAsset: 'herb.png' }, 
        "phoenixbloodHerb": { name: "Phoenixblood Herb", description: "Burns away impurities; ideal for advancing into Nascent Soul.", type: "material", tier: 3, isRare: true, forRealmBreak: 4, gameAsset: 'herb.png' }, 
        "ascensionOrchid": { name: "Ascension Orchid", description: "Rare orchid that assists in Soul Formation breakthroughs.", type: "material", tier: 4, isRare: true, forRealmBreak: 5, gameAsset: 'herb.png' }, 
        "heavenpierceRoot": { name: "Heavenpierce Root", description: "Violently clears bottlenecks; high risk, high reward.", type: "material", tier: 4, isRare: true, forRealmBreak: 5, gameAsset: 'herb.png' }, 
        "divineFlameGrass": { name: "Divine Flame Grass", description: "Contains pure yang energy; used for fiery breakthroughs.", type: "material", tier: 3, isRare: true, gameAsset: 'herb.png' }, 
        "lunarBloom": { name: "Lunar Bloom", description: "Yin energy concentrated herb, used in realm balance pills.", type: "material", tier: 3, isRare: true, gameAsset: 'herb.png' }, 
        "immortalDustleaf": { name: "Immortal Dustleaf", description: "Needed for Transcendence Elixirs.", type: "material", tier: 5, isRare: true, forRealmBreak: 6, gameAsset: 'herb.png' }, 
        "voidberryThorn": { name: "Voidberry Thorn", description: "Bitter but crucial for soul ascension.", type: "material", tier: 5, isRare: true, forRealmBreak: 6, gameAsset: 'herb.png' },
        "thunderclapFruit": { name: "Thunderclap Fruit", description: "Shocks dantian to force enlightenment at high realms.", type: "material", tier: 5, isRare: true, gameAsset: 'herb.png' }, // Placeholder
        
        "starforgePetal": { name: "Starforge Petal", description: "A petal that glimmers with starlight.", type: "material", tier: 4, gameAsset: 'herb.png' },
        "stoneheartRoot": { name: "Stoneheart Root", description: "A root as hard as stone, imbued with earth essence.", type: "material", tier: 4, gameAsset: 'herb.png' },
        "spiritEyeFlower": { name: "Spirit-Eye Flower", description: "A flower that seems to gaze into the spiritual realm.", type: "material", tier: 3, gameAsset: 'herb.png' },
        "heartblossomBud": { name: "Heartblossom Bud", description: "A bud said to open one's heart to spiritual senses.", type: "material", tier: 3, gameAsset: 'herb.png' },
        "silverstormLeaf": { name: "Silverstorm Leaf", description: "A leaf that moves with incredible speed, even in stillness.", type: "material", tier: 3, gameAsset: 'herb.png' },
        "goldenDantianFruit": { name: "Golden Dantian Fruit", description: "A fruit believed to strengthen a cultivator's core.", type: "material", tier: 4, gameAsset: 'herb.png' }, // Placeholder
        "blackflameGinseng": { name: "Blackflame Ginseng", description: "Ginseng that smolders with dark fire.", type: "material", tier: 4, isRare: true, gameAsset: 'herb.png' },
        "frostmarrowMoss": { name: "Frostmarrow Moss", description: "Moss that chills to the bone, yet preserves essence.", type: "material", tier: 4, isRare: true, gameAsset: 'herb.png' },
        "harmonizingBellvine": { name: "Harmonizing Bellvine", description: "A vine whose flowers chime with balancing energies.", type: "material", tier: 5, gameAsset: 'herb.png' },
        "eyeOfTheAncients": { name: "Eye of the Ancients", description: "A petrified eye that seems to hold ancient knowledge.", type: "material", tier: 5, isRare: true, gameAsset: 'stone.png' } // Placeholder
    },
    
    REALM_HERB_DROPS: {
        1: [ 
            { itemId: 'jadeleafGrass', chance: 0.45, minQuantity: 1, maxQuantity: 3 }, 
            { itemId: 'crimsonSpiritBerry', chance: 0.30, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'breakthroughVine', chance: 0.08, minQuantity: 1, maxQuantity: 1 } 
        ],
        2: [ 
            { itemId: 'jadeleafGrass', chance: 0.20, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'crimsonSpiritBerry', chance: 0.35, minQuantity: 1, maxQuantity: 3 },
            { itemId: 'soothingRainPetal', chance: 0.30, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'moondewFlower', chance: 0.20, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'spiritEyeFlower', chance: 0.10, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'dragonboneFern', chance: 0.07, minQuantity: 1, maxQuantity: 1 } 
        ],
        3: [ 
            { itemId: 'soothingRainPetal', chance: 0.20, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'moondewFlower', chance: 0.25, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'earthrootGinseng', chance: 0.35, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'whisperingLeaf', chance: 0.15, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'heartblossomBud', chance: 0.12, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'silverstormLeaf', chance: 0.10, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'phoenixbloodHerb', chance: 0.06, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'divineFlameGrass', chance: 0.04, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'lunarBloom', chance: 0.04, minQuantity: 1, maxQuantity: 1 }      
        ],
        4: [ 
            { itemId: 'earthrootGinseng', chance: 0.15, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'whisperingLeaf', chance: 0.20, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'skyLotusBud', chance: 0.30, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'radiantSunfruit', chance: 0.15, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'starforgePetal', chance: 0.08, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'stoneheartRoot', chance: 0.08, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'goldenDantianFruit', chance: 0.07, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'blackflameGinseng', chance: 0.05, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'frostmarrowMoss', chance: 0.05, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'ascensionOrchid', chance: 0.05, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'heavenpierceRoot', chance: 0.03, minQuantity: 1, maxQuantity: 1 } 
        ],
        5: [ 
            { itemId: 'skyLotusBud', chance: 0.15, minQuantity: 1, maxQuantity: 2 },
            { itemId: 'radiantSunfruit', chance: 0.20, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'cloudmossVine', chance: 0.25, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'spiritglowMushroom', chance: 0.10, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'harmonizingBellvine', chance: 0.06, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'eyeOfTheAncients', chance: 0.04, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'immortalDustleaf', chance: 0.04, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'voidberryThorn', chance: 0.03, minQuantity: 1, maxQuantity: 1 },    
            { itemId: 'thunderclapFruit', chance: 0.02, minQuantity: 1, maxQuantity: 1 } 
        ],
        6: [ 
            { itemId: 'cloudmossVine', chance: 0.10, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'spiritglowMushroom', chance: 0.08, minQuantity: 1, maxQuantity: 1 },
            { itemId: 'immortalDustleaf', chance: 0.05, minQuantity: 1, maxQuantity: 1 }, 
            { itemId: 'voidberryThorn', chance: 0.04, minQuantity: 1, maxQuantity: 1 },    
            { itemId: 'thunderclapFruit', chance: 0.03, minQuantity: 1, maxQuantity: 1 } 
        ]
    },
    getRealmTier: function(cultivationLevel) {
        if (cultivationLevel >= 46) return 6; 
        if (cultivationLevel >= 37) return 5; 
        if (cultivationLevel >= 28) return 4; 
        if (cultivationLevel >= 19) return 3; 
        if (cultivationLevel >= 10) return 2; 
        return 1; 
    },

    CULTIVATOR_CLASSES: {
        "martial_cultivator": { name: "Martial Cultivator", specialty: "Physical combat, brute strength, melee dominance, endurance.", recommendation: "Frontline DPS or tank roles; players who enjoy direct combat and body refinement.", effect: (player) => { player.attack += 5; player.maxHealth += 20; player.health = player.maxHealth; displayMessage("Your physique strengthens! +5 Attack, +20 Max Health.", "class-info"); } },
        "qi_cultivator": { name: "Qi Cultivator", specialty: "Elemental spells, ranged attacks, flying swords, formations.", recommendation: "Ranged DPS, strategic players focused on spellcasting and control.", effect: (player) => { player.maxQi += 20; player.currentQi = player.maxQi; displayMessage("You feel a natural affinity for Qi. Your meditation is more effective & Max QI increased by 20.", "class-info");} },
        "alchemist": { name: "Alchemist", specialty: "Crafting pills for healing, breakthrough, poison, or buffing.", recommendation: "Support role or merchant-style gameplay; influences world through economics and rare pill production.", effect: (player) => { player.resources.jadeleafGrass = (player.resources.jadeleafGrass || 0) + 5; player.resources.crimsonSpiritBerry = (player.resources.crimsonSpiritBerry || 0) + 3; displayMessage("You start with an innate knowledge of herbs. +5 Jadeleaf Grass, +3 Crimson Spirit Berry.", "class-info");} },
        "artifact_refiner": { name: "Artifact Refiner", specialty: "Forging spiritual weapons, defensive artifacts, arrays.", recommendation: "Crafters and strategic support players who arm others or gain power through custom gear.", effect: (player) => { player.resources.roughIronOre = (player.resources.roughIronOre || 0) + 3; displayMessage("You have a knack for finding quality materials. +3 Rough Iron Ore.", "class-info");} },
        "talisman_master": { name: "Talisman Master", specialty: "Drawing talismans for attack, defense, sealing, summoning.", recommendation: "Burst combat or utility players who enjoy preparation and setup playstyles.", effect: (player) => { player.resources.blankTalismanPaper = (player.resources.blankTalismanPaper || 0) + 10; displayMessage("You begin with a supply of talisman paper. +10 Blank Talisman Paper.", "class-info");} },
        "formation_master": { name: "Formation Master", specialty: "Setting up battlefield formations for area control, traps, or enhancement.", recommendation: "Tactical thinkers; for team buffs, enemy restriction, and battlefield control." },
        "beast_tamer": { name: "Beast Tamer", specialty: "Taming and commanding spirit beasts or demonic creatures.", recommendation: "Summoner-style players, beast combat synergy, or solo adventuring with companions." },
        "poison_master": { name: "Poison Master", specialty: "Toxins, stealth, curse arts, assassination.", recommendation: "Debuffers, rogue-style gameplay, or players who enjoy subversive tactics." },
        "puppet_master": { name: "Puppet Master", specialty: "Constructs animated puppets for combat, defense, spying.", recommendation: "Tech/artifact lovers, indirect combat style, and versatile setups." },
        "soul_cultivator": { name: "Soul Cultivator", specialty: "Attacks based on divine soul/spiritual awareness, illusions, or mind control.", recommendation: "High-risk, high-reward players; focuses on soul damage and mental battles." },
        "demon_cultivator": { name: "Demon Cultivator", specialty: "Dark techniques, fast growth through taboo methods, body possession, curses.", recommendation: "Villainous or anti-hero players; strong but risky path with moral choices.", effect: (player) => { player.demonicCorruption = 0; displayMessage("You tread the path of demons. Be wary of corruption.", "class-info");} },
        "heavenly_oracle": { name: "Heavenly Oracle", specialty: "Prophecy, luck manipulation, fate techniques.", recommendation: "Utility/support or RP-focused players; can influence events or gain rare opportunities." }
    },
    
    async saveCurrentPlayerState() {
        if (!this.currentPlayerId || !this.players[this.currentPlayerId]) {
            console.error("No current player to save.");
            return;
        }
        const player = this.players[this.currentPlayerId];
        try {
            const playerData = player.toFirestoreObject();
            await setDoc(doc(db, "players", player.playerId), playerData);
        } catch (error) {
            console.error("Error saving player state:", error);
            displayMessage("Failed to save your progress. Check connection.", "error");
        }
    },

    initializeGame() {
        this.loadPillDataFromCSV(pillCsvData); 
        displayMessage("=== Welcome to the Path of the Ascendant Dragon ===", 'important');
        displayMessage("A Wuxia Cultivation RPG", 'narration');
        this.showMainGate();
    },
    showMainGate() {
        this.currentGameState = 'MAIN_GATE'; this.currentPlayerId = null; 
        uiElements.combatInterface.style.display = 'none'; 
        uiElements.classSelectionInfoDiv.style.display = 'none';
        uiElements.inventoryMenuDiv.style.display = 'none'; 
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none'; 
        uiElements.marketMenuDiv.style.display = 'none';
        uiElements.marketListingsViewDiv.style.display = 'none';
        uiElements.concoctionMenuDiv.style.display = 'none'; 
        uiElements.combatSpecificActions.innerHTML = ''; 
        uiElements.actionButtonsContainer.innerHTML = ''; 
        displayMessage("\n--- Main Gate ---", 'system');
        populateActionButtons([ 
            { text: "Create Cultivator", action: "create_account", style: "confirm" },
            { text: "Login", action: "login", style: "confirm" },
            { text: "Exit (Reload Page)", action: "exit_game", style: "danger" }
        ], uiElements.actionButtonsContainer);
        uiElements.statName.textContent = "Nameless One"; uiElements.statClass.textContent = "Undetermined"; 
        uiElements.statRealm.textContent = "Mortal"; uiElements.statLevel.textContent = "0"; 
        uiElements.statSpiritualRoot.textContent = "Undetermined";
        uiElements.statProgress.textContent = "0/0 XP";
        uiElements.statHealth.textContent = "N/A"; uiElements.statQi.textContent = "N/A";
        uiElements.statAttack.textContent = "N/A"; uiElements.statDefense.textContent = "N/A"; 
        uiElements.statSpiritStones.textContent = "N/A";
        uiElements.statSect.textContent = "None"; 
        uiElements.statWeapon.textContent = "Unarmed";
        uiElements.statDemonicCorruptionContainer.style.display = 'none';

        if (uiElements.chatInput) {
            uiElements.chatInput.disabled = true;
            uiElements.chatInput.placeholder = "Login to chat...";
            uiElements.chatInput.value = '';
        }
        if (uiElements.chatSendButton) uiElements.chatSendButton.disabled = true;
        if (uiElements.chatLogContainer) uiElements.chatLogContainer.innerHTML = ''; 
    },
    toggleGridInventoryModal() {
        const player = this.players[this.currentPlayerId];
        if (!uiElements.gridInventoryModal || !player) return;

        if (uiElements.gridInventoryModal.style.display === 'none' || uiElements.gridInventoryModal.style.display === '') {
            populateModalInventoryGrid(player); 
            uiElements.gridInventoryModal.style.display = 'flex';
        } else {
            uiElements.gridInventoryModal.style.display = 'none';
        }
    },
    showLoggedInMenu() {
        this.currentGameState = 'LOGGED_IN_MENU'; 
        uiElements.combatInterface.style.display = 'none'; 
        uiElements.classSelectionInfoDiv.style.display = 'none';
        uiElements.inventoryMenuDiv.style.display = 'none'; 
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none'; 
        uiElements.marketMenuDiv.style.display = 'none';
        uiElements.marketListingsViewDiv.style.display = 'none';
        uiElements.concoctionMenuDiv.style.display = 'none'; 
        uiElements.combatSpecificActions.innerHTML = ''; 

        const player = this.players[this.currentPlayerId]; if (!player) { this.logout(); return; }

        if (!player.hasRolledSpiritualRoot) {
            displayMessage(`\nWelcome, ${player.name}. Your destiny awaits the revealing of your Spiritual Roots.`, 'system');
            populateActionButtons([
                { text: "Divine Your Spiritual Roots", action: "roll_spiritual_root", style: "divine" },
                { text: "Logout", action: "logout", style: "neutral" }
            ], uiElements.actionButtonsContainer);
            updateStatsDisplay(player);
            return;
        }
        if (!player.hasClassChosen) {
            this.showClassSelectionMenu();
            return;
        }

        if (!player.isAlive()) {
            displayMessage("\nIncapacitated. Recover health.", 'error'); player.health = Math.floor(player.maxHealth / 4);
            displayMessage(`Recovered some health. HP: ${player.health}/${player.maxHealth}`, 'success');
            if (!player.isAlive()) { displayMessage("Still weak. Meditate.", 'error');}
            this.saveCurrentPlayerState(); 
        }
        updateStatsDisplay(player); 
        displayMessage(`\n--- ${player.name}'s Journey (${player.getCultivationRealmName()}) ---`, 'system');
        
        let menuActions = [ 
            { text: "Meditate", action: "meditate", style: "confirm" }, 
            { text: "Explore Area", action: "explore" },
            { text: "Inventory", action: "toggle_grid_inventory", style: "special" }, 
            { text: "Marketplace", action: "show_market_menu", style: "special" }, 
            { text: "Concoct Pills", action: "show_concoction_menu", style: "special" }, 
            { text: "View My Stats", action: "view_stats" }, 
            { text: "Sect Hall", action: "manage_sects", style: "special" },
            { text: "Challenge Rival (PvP)", action: "pvp", style: "danger" }
        ];

        if (player.chosenClassKey === 'artifact_refiner') {
             menuActions.splice(4,0, { text: "Forge Artifact", action: "forge_artifact", style: "special" }); 
        } else if (player.chosenClassKey === 'talisman_master') {
             menuActions.splice(4,0, { text: "Draw Talisman", action: "draw_talisman", style: "special" }); 
        }

        menuActions.push({ text: "Logout", action: "logout", style: "neutral" });
        populateActionButtons(menuActions, uiElements.actionButtonsContainer);
    },
    showClassSelectionMenu() {
        this.currentGameState = 'CLASS_SELECTION';
        uiElements.classSelectionInfoDiv.style.display = 'block';
        uiElements.inventoryMenuDiv.style.display = 'none';
        uiElements.marketMenuDiv.style.display = 'none';
        uiElements.marketListingsViewDiv.style.display = 'none';
        uiElements.concoctionMenuDiv.style.display = 'none';
        uiElements.classSelectionInfoDiv.innerHTML = '<h3>Choose Your Path</h3><p>Select a class to view its details, then confirm your choice.</p>';
        this.selectedClassForInfo = null; 

        const player = this.players[this.currentPlayerId];
        displayMessage(`\n${player.name}, with your <span class="spiritual-root">${player.spiritualRootName}</span>, it is time to choose your cultivation path.`, 'system');
        
        let classButtons = [];
        for (const classKey in this.CULTIVATOR_CLASSES) {
            classButtons.push({ text: this.CULTIVATOR_CLASSES[classKey].name, action: 'show_class_info', value: classKey, style: 'class_select' });
        }
        classButtons.push({ text: "Confirm Class", action: "select_class", value: null, style: "confirm" }); 
        classButtons.push({ text: "Logout", action: "logout", style: "neutral" });
        
        populateActionButtons(classButtons, uiElements.actionButtonsContainer);
    },
    showClassInfo(classKey) {
        const classData = this.CULTIVATOR_CLASSES[classKey];
        if (!classData) return;
        this.selectedClassForInfo = classKey; 

        uiElements.classSelectionInfoDiv.innerHTML = `
            <h3>${classData.name}</h3>
            <p><strong>Specialty:</strong> ${classData.specialty}</p>
            <p><strong>Recommended for:</strong> ${classData.recommendation}</p>
        `;
        let classButtons = [];
        for (const key in this.CULTIVATOR_CLASSES) {
            classButtons.push({ text: this.CULTIVATOR_CLASSES[key].name, action: 'show_class_info', value: key, style: 'class_select' });
        }
        classButtons.push({ text: `Confirm ${classData.name}`, action: "select_class", value: classKey, style: "confirm" });
        classButtons.push({ text: "Logout", action: "logout", style: "neutral" });
        populateActionButtons(classButtons, uiElements.actionButtonsContainer);
    },
    async selectClass(classKey) {
        const player = this.players[this.currentPlayerId];
        if (!player || !classKey || !this.CULTIVATOR_CLASSES[classKey]) {
            displayMessage("Invalid class selection.", "error");
            this.showClassSelectionMenu();
            return;
        }
        const chosenClassData = this.CULTIVATOR_CLASSES[classKey];
        player.chosenClassName = chosenClassData.name;
        player.chosenClassKey = classKey;
        player.hasClassChosen = true;

        displayMessage(`You have chosen the path of the <span class="class-info">${chosenClassData.name}</span>!`, "success");
        
        if (typeof chosenClassData.effect === 'function') {
            chosenClassData.effect(player);
        }

        await this.saveCurrentPlayerState(); 
        updateStatsDisplay(player);
        uiElements.classSelectionInfoDiv.style.display = 'none'; 
        this.showLoggedInMenu();
    },
    async useItem(itemKey) {
        const player = this.players[this.currentPlayerId];
        const itemData = Game.ITEM_DATA[itemKey];
        if (!player || !itemData || !player.resources[itemKey] || player.resources[itemKey] <= 0) {
            displayMessage("Item not found or out of stock.", "error");
            return;
        }

        let itemConsumedOrChanged = false;

        if (itemData.type === 'consumable' || itemData.type === 'recipe') { 
            const originalQuantity = player.resources[itemKey];
            itemData.effect(player); 
            if(player.resources[itemKey] < originalQuantity || itemData.type === 'recipe') { 
                itemConsumedOrChanged = true;
            }
        } else if (itemData.type === 'weapon') {
            if (player.equippedWeapon && player.equippedWeapon === itemKey) {
                displayMessage(`${itemData.name} is already equipped.`, "narration");
            } else {
                if (player.equippedWeapon) { 
                     displayMessage(`Unequipped ${Game.ITEM_DATA[player.equippedWeapon].name}.`, "item-use");
                }
                itemData.equipEffect(player); 
                itemConsumedOrChanged = true; 
            }
        }
        
        if (itemConsumedOrChanged || this.currentCombat) { 
            updateStatsDisplay(player); 
            await this.saveCurrentPlayerState(); 
            if (uiElements.gridInventoryModal && (uiElements.gridInventoryModal.style.display === 'flex' || uiElements.gridInventoryModal.style.display === 'block')) {
                populateModalInventoryGrid(player);
            }
        }
    },
    showMarketMenu() {
        this.currentGameState = 'MARKET_MENU';
        uiElements.marketMenuDiv.style.display = 'block';
        uiElements.marketListingsViewDiv.style.display = 'none'; 
        uiElements.actionButtonsContainer.innerHTML = '';
        uiElements.inventoryMenuDiv.style.display = 'none';
        uiElements.classSelectionInfoDiv.style.display = 'none';
        uiElements.concoctionMenuDiv.style.display = 'none';
        uiElements.combatInterface.style.display = 'none';
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none';


        uiElements.marketMenuDiv.innerHTML = '<h3>Marketplace</h3>';
        displayMessage("Welcome to the Marketplace. What would you like to do?", "market");

        populateActionButtons([
            { text: "List Item for Sale", action: "market_list_item_select", style: "market_action"},
            { text: "View Market Listings", action: "market_view_listings", style: "market_action"}, 
            { text: "Back to Menu", action: "show_logged_in_menu", style: "neutral"}
        ], uiElements.marketMenuDiv); 
    },
    async marketListItemSelect() {
        const player = this.players[this.currentPlayerId];
        if (!player) return;

        uiElements.marketMenuDiv.innerHTML = '<h3>List Item for Sale - Select Item</h3>';
        let itemsToList = [];
        for (const itemKey in player.resources) {
            if (player.resources[itemKey] > 0 && Game.ITEM_DATA[itemKey]) {
                const itemData = Game.ITEM_DATA[itemKey];
                if (itemData.type !== 'currency' && itemData.type !== 'quest_item') { 
                     itemsToList.push({
                        text: `${itemData.name} (x${player.resources[itemKey]})`,
                        action: 'list_item_for_sale_prompt', 
                        value: itemKey, 
                        style: 'inventory_item_original' 
                    });
                }
            }
        }

        if (itemsToList.length === 0) {
            uiElements.marketMenuDiv.innerHTML += '<p class="text-gray-500 text-center">You have no items to list.</p>';
        }
        populateActionButtons(itemsToList, uiElements.marketMenuDiv);

        const backButton = document.createElement('button');
        backButton.textContent = "Back to Marketplace";
        backButton.classList.add('action-button', 'bg-gray-600', 'hover:bg-gray-700', 'text-white', 'font-semibold', 'py-2', 'px-4', 'rounded-lg', 'shadow-md', 'm-1', 'mt-4', 'mx-auto', 'block');
        backButton.onclick = () => this.showMarketMenu();
        uiElements.marketMenuDiv.appendChild(backButton);
    },

    async promptListItemForSale(itemKey) {
        const player = this.players[this.currentPlayerId];
        const itemData = Game.ITEM_DATA[itemKey];
        if (!player || !itemData || !player.resources[itemKey] || player.resources[itemKey] <= 0) {
            displayMessage("Invalid item or no stock.", "error");
            this.showMarketMenu();
            return;
        }

        const quantityToSellStr = await getModalInput(`How many ${itemData.name} to sell? (You have ${player.resources[itemKey]})`, 'number');
        const quantityToSell = parseInt(quantityToSellStr);

        if (isNaN(quantityToSell) || quantityToSell <= 0 || quantityToSell > player.resources[itemKey]) {
            displayMessage("Invalid quantity or not enough stock.", "error");
            this.showMarketMenu();
            return;
        }

        const pricePerItemStr = await getModalInput(`Price per ${itemData.name} (in Spirit Stones):`, 'number');
        const pricePerItem = parseInt(pricePerItemStr);

        if (isNaN(pricePerItem) || pricePerItem <= 0) {
            displayMessage("Invalid price.", "error");
            this.showMarketMenu();
            return;
        }

        const confirm = await getModalInput(`List ${quantityToSell}x ${itemData.name} for ${pricePerItem} Spirit Stones each? (Total: ${quantityToSell * pricePerItem}) (yes/no)`);
        if (confirm && confirm.toLowerCase() === 'yes') {
            await this.listItemOnMarket(itemKey, quantityToSell, pricePerItem);
        } else {
            displayMessage("Listing cancelled.", "narration");
            this.showMarketMenu();
        }
    },

    async listItemOnMarket(itemKey, quantity, pricePerItem) {
        const player = this.players[this.currentPlayerId];
        if (!player || !Game.ITEM_DATA[itemKey] || player.resources[itemKey] < quantity) {
            displayMessage("Cannot list item: Insufficient stock or invalid item.", "error");
            this.showMarketMenu(); 
            return;
        }

        player.resources[itemKey] -= quantity; 

        const listingId = generateFirestoreId("marketListings"); // Use helper
        const listingData = {
            listingId: listingId,
            itemId: itemKey,
            itemName: Game.ITEM_DATA[itemKey].name,
            quantity: quantity,
            pricePerItem: pricePerItem,
            sellerId: player.playerId,
            sellerName: player.name,
            listedAt: fsServerTimestamp(),
            status: "active" 
        };

        try {
            await setDoc(doc(db, "marketListings", listingId), listingData);
            await this.saveCurrentPlayerState(); 
            displayMessage(`${quantity}x ${listingData.itemName} listed on the market for ${pricePerItem} Spirit Stones each.`, "market");
            updateStatsDisplay(player); 
        } catch (error) {
            console.error("Error listing item on market:", error);
            displayMessage("Failed to list item. Please try again.", "error");
            player.resources[itemKey] += quantity; 
        }
        this.showMarketMenu(); 
    },
    async showMarketListings() {
        this.currentGameState = 'VIEW_MARKET_LISTINGS';
        uiElements.marketListingsViewDiv.style.display = 'block';
        uiElements.marketMenuDiv.style.display = 'none'; 
        uiElements.actionButtonsContainer.innerHTML = ''; 
        uiElements.concoctionMenuDiv.style.display = 'none';
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none';


        uiElements.marketListingsViewDiv.innerHTML = '<h3>Active Market Listings</h3>';
        displayMessage("Fetching market listings...", "system");

        const player = this.players[this.currentPlayerId];
        if (!player) { this.showMarketMenu(); return; }


        try {
            const q = query(collection(db, "marketListings"), 
                            where("status", "==", "active"), 
                            orderBy("listedAt", "desc"), 
                            limitToLast(20));
            const listingsQuery = await getDocs(q);
            
            if (listingsQuery.empty) {
                uiElements.marketListingsViewDiv.innerHTML += '<p class="text-gray-500 text-center">The marketplace is currently empty.</p>';
            } else {
                let listingsHtml = '<div class="space-y-2">';
                listingsQuery.forEach(docSnap => { // docSnap, not doc
                    const listing = docSnap.data();
                    const totalPrice = listing.quantity * listing.pricePerItem;
                    // Make Game globally accessible for these onclicks or refactor to addEventListeners
                    listingsHtml += `
                        <div class="market-listing-item p-2 bg-gray-700 rounded">
                            <p class="font-semibold text-lg">${listing.itemName} (x${listing.quantity})</p>
                            <p class="text-sm">Price: ${listing.pricePerItem} Spirit Stones each</p>
                            <p class="text-sm">Total: ${totalPrice} Spirit Stones</p>
                            <p class="text-xs text-gray-400">Seller: ${listing.sellerName} ${listing.sellerId === player.playerId ? "(You)" : ""}</p>
                            ${listing.sellerId !== player.playerId ?
                                `<button class="action-button bg-green-600 hover:bg-green-700 text-white text-sm py-1 px-3 rounded mt-1" onclick="window.Game.promptBuyItem('${listing.listingId}')">Buy</button>` :
                                `<button class="action-button bg-red-600 hover:bg-red-700 text-white text-sm py-1 px-3 rounded mt-1" onclick="window.Game.promptRemoveListing('${listing.listingId}')">Remove Listing</button>`
                            }
                        </div>
                    `;
                });
                listingsHtml += '</div>';
                uiElements.marketListingsViewDiv.innerHTML += listingsHtml;
            }
        } catch (error) {
            console.error("Error fetching market listings:", error);
            uiElements.marketListingsViewDiv.innerHTML += '<p class="text-red-500 text-center">Could not load market listings. Please try again later.</p>';
        }

        const backButton = document.createElement('button');
        backButton.textContent = "Back to Marketplace";
        backButton.classList.add('action-button', 'bg-gray-600', 'hover:bg-gray-700', 'text-white', 'font-semibold', 'py-2', 'px-4', 'rounded-lg', 'shadow-md', 'm-1', 'mt-4', 'mx-auto', 'block');
        backButton.onclick = () => this.showMarketMenu();
        uiElements.marketListingsViewDiv.appendChild(backButton);
    },
    async promptBuyItem(listingId) {
        const buyer = this.players[this.currentPlayerId];
        if (!buyer) return;

        uiElements.marketListingsViewDiv.style.display = 'none'; 

        try {
            const listingDocRef = doc(db, "marketListings", listingId);
            const listingDocSnap = await getDoc(listingDocRef);
            if (!listingDocSnap.exists()) {
                displayMessage("Listing no longer available.", "error");
                this.showMarketListings(); return;
            }
            const listingData = listingDocSnap.data();

            if (listingData.status !== 'active') {
                displayMessage("This item is no longer for sale.", "error");
                this.showMarketListings(); return;
            }
            if (listingData.sellerId === buyer.playerId) {
                displayMessage("You cannot buy your own items.", "error");
                this.showMarketListings(); return;
            }

            let quantityToBuy = 1;
            if (listingData.quantity > 1) {
                const quantityStr = await getModalInput(`How many ${listingData.itemName} to buy? (Max ${listingData.quantity}, Price: ${listingData.pricePerItem} each)`, 'number');
                quantityToBuy = parseInt(quantityStr);
                if (isNaN(quantityToBuy) || quantityToBuy <= 0 || quantityToBuy > listingData.quantity) {
                    displayMessage("Invalid quantity.", "error");
                    this.showMarketListings(); return;
                }
            }

            const totalPrice = listingData.pricePerItem * quantityToBuy;
            if ((buyer.resources.spiritStones || 0) < totalPrice) {
                displayMessage(`Not enough Spirit Stones. You need ${totalPrice}, but have ${buyer.resources.spiritStones || 0}.`, "error");
                this.showMarketListings(); return;
            }

            const confirm = await getModalInput(`Buy ${quantityToBuy}x ${listingData.itemName} for ${totalPrice} Spirit Stones? (yes/no)`);
            if (confirm && confirm.toLowerCase() === 'yes') {
                await this.executeBuyItem(listingId, quantityToBuy);
            } else {
                displayMessage("Purchase cancelled.", "narration");
                this.showMarketListings();
            }

        } catch (error) {
            console.error("Error prompting for buy:", error);
            displayMessage("Error processing purchase. Please try again.", "error");
            this.showMarketListings();
        }
    },
    async executeBuyItem(listingId, quantityToBuy) {
        const buyer = this.players[this.currentPlayerId];
        if (!buyer) return;

        try {
            await runTransaction(db, async (transaction) => {
                const listingRef = doc(db, "marketListings", listingId);
                const listingDoc = await transaction.get(listingRef);

                if (!listingDoc.exists()) throw new Error("Listing not found.");
                const listingData = listingDoc.data();

                if (listingData.status !== "active") throw new Error("This listing is no longer active.");
                if (listingData.quantity < quantityToBuy) throw new Error("Not enough items in stock for this quantity.");
                if (listingData.sellerId === buyer.playerId) throw new Error("You cannot buy your own items.");
                
                const totalPrice = listingData.pricePerItem * quantityToBuy;
                if ((buyer.resources.spiritStones || 0) < totalPrice) throw new Error("Not enough Spirit Stones.");

                const sellerRef = doc(db, "players", listingData.sellerId);
                const sellerDoc = await transaction.get(sellerRef);
                if (!sellerDoc.exists()) throw new Error("Seller not found. Purchase cannot be completed.");
                const sellerData = sellerDoc.data();

                const newBuyerResources = { ...(buyer.resources || {}) };
                newBuyerResources.spiritStones = (newBuyerResources.spiritStones || 0) - totalPrice;
                newBuyerResources[listingData.itemId] = (newBuyerResources[listingData.itemId] || 0) + quantityToBuy;

                const newSellerResources = { ...(sellerData.resources || {}) };
                newSellerResources.spiritStones = (newSellerResources.spiritStones || 0) + totalPrice;

                transaction.update(listingRef, {
                    quantity: listingData.quantity - quantityToBuy,
                    status: (listingData.quantity - quantityToBuy === 0) ? "sold" : "active"
                });
                const buyerRef = doc(db, "players", buyer.playerId);
                transaction.update(buyerRef, { resources: newBuyerResources });
                transaction.update(sellerRef, { resources: newSellerResources });

                this.tempTransactionData = {
                    buyerResources: newBuyerResources,
                    itemBoughtId: listingData.itemId,
                    itemBoughtName: listingData.itemName, 
                    quantityBought: quantityToBuy
                };
            });

            buyer.resources = this.tempTransactionData.buyerResources;
            displayMessage(`Successfully purchased ${this.tempTransactionData.quantityBought}x ${this.tempTransactionData.itemBoughtName}.`, "market");
            
            updateStatsDisplay(buyer); 

        } catch (error) {
            console.error("Transaction failed: ", error);
            displayMessage(`Purchase failed: ${error.message}`, "error");
        } finally {
            delete this.tempTransactionData; 
            this.showMarketListings(); 
        }
    },
    async promptRemoveListing(listingId) {
        const player = this.players[this.currentPlayerId];
        if (!player) return;

        uiElements.marketListingsViewDiv.style.display = 'none'; 

        try {
            const listingDocRef = doc(db, "marketListings", listingId);
            const listingDocSnap = await getDoc(listingDocRef);
            if (!listingDocSnap.exists()) {
                displayMessage("Listing no longer available.", "error");
                this.showMarketListings(); return;
            }
            const listingData = listingDocSnap.data();

            if (listingData.sellerId !== player.playerId) {
                displayMessage("This is not your listing.", "error");
                this.showMarketListings(); return;
            }
            if (listingData.status !== 'active') {
                displayMessage("This listing is not active and cannot be removed.", "error");
                this.showMarketListings(); return;
            }

            const confirm = await getModalInput(`Remove your listing of ${listingData.quantity}x ${listingData.itemName}? The items will be returned to your inventory. (yes/no)`);
            if (confirm && confirm.toLowerCase() === 'yes') {
                await this.executeRemoveListing(listingId);
            } else {
                displayMessage("Removal cancelled.", "narration");
                this.showMarketListings();
            }

        } catch (error) {
            console.error("Error prompting for removal:", error);
            displayMessage("Error processing removal. Please try again.", "error");
            this.showMarketListings();
        }
    },
    async executeRemoveListing(listingId) {
        const player = this.players[this.currentPlayerId];
        if (!player) return;

        try {
            await runTransaction(db, async (transaction) => {
                const listingRef = doc(db, "marketListings", listingId);
                const listingDoc = await transaction.get(listingRef);

                if (!listingDoc.exists()) throw new Error("Listing not found.");
                const listingData = listingDoc.data();

                if (listingData.sellerId !== player.playerId) throw new Error("Cannot remove: Not your listing.");
                if (listingData.status !== "active") throw new Error("Cannot remove: Listing is not active.");

                const newPlayerResources = { ...(player.resources || {}) };
                newPlayerResources[listingData.itemId] = (newPlayerResources[listingData.itemId] || 0) + listingData.quantity;
                
                transaction.update(listingRef, { status: "removed" });

                const playerRef = doc(db, "players", player.playerId);
                transaction.update(playerRef, { resources: newPlayerResources });

                this.tempTransactionData = {
                    playerResources: newPlayerResources,
                    itemRemovedId: listingData.itemId,
                    itemRemovedName: listingData.itemName,
                    quantityRemoved: listingData.quantity
                };
            });

            player.resources = this.tempTransactionData.playerResources;
            displayMessage(`Successfully removed ${this.tempTransactionData.quantityRemoved}x ${this.tempTransactionData.itemRemovedName} from the market. Items returned to inventory.`, "market");

            updateStatsDisplay(player); 

        } catch (error) {
            console.error("Transaction failed (Remove Listing): ", error);
            displayMessage(`Removal failed: ${error.message}`, "error");
        } finally {
            delete this.tempTransactionData; 
            this.showMarketListings(); 
        }
    },

    showConcoctionMenu() {
        this.currentGameState = 'CONCOCTION_MENU';
        uiElements.concoctionMenuDiv.style.display = 'block';
        uiElements.actionButtonsContainer.innerHTML = ''; 
        uiElements.inventoryMenuDiv.style.display = 'none';
        uiElements.marketMenuDiv.style.display = 'none';
        uiElements.marketListingsViewDiv.style.display = 'none';
        uiElements.classSelectionInfoDiv.style.display = 'none';
        uiElements.combatInterface.style.display = 'none';
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none';


        const player = this.players[this.currentPlayerId];
        if (!player) { this.showMainGate(); return; }

        uiElements.concoctionMenuDiv.innerHTML = '<h3>Pill Concoction Chamber</h3>';
        let availableRecipes = [];

        for (const recipeKey in Game.PILL_RECIPES) {
            const recipe = Game.PILL_RECIPES[recipeKey];
            if (recipe.isBasic || (player.knownRecipes && player.knownRecipes.includes(recipeKey))) {
                if (player.cultivationLevel >= recipe.requiredCultivationLevel) {
                    availableRecipes.push(recipe);
                }
            }
        }
        
        if (availableRecipes.length === 0) {
            uiElements.concoctionMenuDiv.innerHTML += '<p class="text-gray-500 text-center">No recipes known or you do not meet requirements.</p>';
        } else {
            availableRecipes.sort((a,b) => a.requiredCultivationLevel - b.requiredCultivationLevel || a.name.localeCompare(b.name));
            
            availableRecipes.forEach(recipe => {
                let ingredientsHtml = '<ul class="concoction-ingredient-list">';
                let canCraft = true;
                for (const ingKey in recipe.ingredients) {
                    const requiredCount = recipe.ingredients[ingKey];
                    const possessedCount = player.resources[ingKey] || 0;
                    const color = possessedCount >= requiredCount ? 'text-green-400' : 'text-red-400';
                    ingredientsHtml += `<li class="${color}">${Game.ITEM_DATA[ingKey].name}: ${possessedCount}/${requiredCount}</li>`;
                    if (possessedCount < requiredCount) canCraft = false;
                }
                ingredientsHtml += '</ul>';

                const recipeDiv = document.createElement('div');
                recipeDiv.classList.add('concoction-recipe-item');
                recipeDiv.innerHTML = `
                    <h4>${recipe.name}</h4>
                    <p><strong>Use:</strong> ${recipe.useDescription}</p>
                    <p><strong>Ingredients:</strong></p>
                    ${ingredientsHtml}
                    <p><strong>Qi Cost:</strong> ${recipe.qiCost}</p>
                    <p><strong>Produces:</strong> ${recipe.productName}</p>
                `;
                
                const concoctButton = document.createElement('button');
                concoctButton.textContent = "Concoct";
                concoctButton.classList.add('action-button', 'bg-lime-600', 'hover:bg-lime-700', 'text-gray-900', 'font-semibold', 'py-1', 'px-3', 'rounded', 'mt-2', 'text-sm');
                if (!canCraft || player.currentQi < recipe.qiCost) {
                    concoctButton.disabled = true;
                    concoctButton.classList.add('opacity-50', 'cursor-not-allowed');
                }
                concoctButton.onclick = () => Game.promptConcoctQuantity(recipe.recipeKey);
                recipeDiv.appendChild(concoctButton);
                uiElements.concoctionMenuDiv.appendChild(recipeDiv);
            });
        }
        
        const backButton = document.createElement('button');
        backButton.textContent = "Back to Menu";
        backButton.classList.add('action-button', 'bg-gray-600', 'hover:bg-gray-700', 'text-white', 'font-semibold', 'py-2', 'px-4', 'rounded-lg', 'shadow-md', 'm-1', 'mt-4', 'mx-auto', 'block');
        backButton.onclick = () => this.showLoggedInMenu();
        uiElements.concoctionMenuDiv.appendChild(backButton);
    },

    async promptConcoctQuantity(recipeKey) {
        const player = this.players[this.currentPlayerId];
        const recipe = Game.PILL_RECIPES[recipeKey];
        if (!player || !recipe) return;

        let maxPossible = Infinity;
        for (const ingKey in recipe.ingredients) {
            maxPossible = Math.min(maxPossible, Math.floor((player.resources[ingKey] || 0) / recipe.ingredients[ingKey]));
        }
        if (recipe.qiCost > 0) {
            maxPossible = Math.min(maxPossible, Math.floor(player.currentQi / recipe.qiCost));
        }
        if (maxPossible === Infinity || maxPossible <= 0) { 
            displayMessage("Cannot concoct: Not enough resources or Qi for even one.", "error");
            this.showConcoctionMenu();
            return;
        }

        const quantityStr = await getModalInput(`How many ${recipe.productName} to concoct? (Max possible: ${maxPossible})`, 'number');
        const quantity = parseInt(quantityStr);

        if (isNaN(quantity) || quantity <= 0) {
            displayMessage("Invalid quantity.", "error");
            this.showConcoctionMenu(); 
            return;
        }
        if (quantity > maxPossible) {
            displayMessage(`Cannot concoct ${quantity}. You can only make up to ${maxPossible}.`, "error");
            this.showConcoctionMenu();
            return;
        }
        await this.executeConcoction(recipeKey, quantity);
    },

    async executeConcoction(recipeKey, quantity) {
        const player = this.players[this.currentPlayerId];
        const recipe = Game.PILL_RECIPES[recipeKey];
        if (!player || !recipe) return;

        if (player.currentQi < recipe.qiCost * quantity) {
            displayMessage(`Not enough Qi. Need ${recipe.qiCost * quantity}, have ${player.currentQi}.`, "error");
            this.showConcoctionMenu(); return;
        }

        for (const ingKey in recipe.ingredients) {
            if ((player.resources[ingKey] || 0) < recipe.ingredients[ingKey] * quantity) {
                displayMessage(`Not enough ${Game.ITEM_DATA[ingKey].name}. Need ${recipe.ingredients[ingKey] * quantity}, have ${player.resources[ingKey] || 0}.`, "error");
                this.showConcoctionMenu(); return;
            }
        }

        player.currentQi -= recipe.qiCost * quantity;

        for (const ingKey in recipe.ingredients) {
            player.resources[ingKey] -= recipe.ingredients[ingKey] * quantity;
        }

        player.resources[recipe.producesItemKey] = (player.resources[recipe.producesItemKey] || 0) + quantity;

        displayMessage(`Successfully concocted ${quantity}x ${recipe.productName}!`, "crafting");
        
        updateStatsDisplay(player); 
        await this.saveCurrentPlayerState();
        this.showConcoctionMenu(); 
    },


    async handlePlayerChoice(action, value) {
        try {
            const player = this.players[this.currentPlayerId];
            if (action === 'create_account') { await this.createAccount(); return; }
            if (action === 'login') { await this.login(); return; }
            if (action === 'exit_game') { window.location.reload(); return; }
            if (action === 'roll_spiritual_root' && player && !player.hasRolledSpiritualRoot) { await this.rollSpiritualRoot(); return; } 
            if (action === 'show_class_info') { this.showClassInfo(value); return; }
            if (action === 'select_class') { await this.selectClass(value); return; } 
            if (action === 'toggle_grid_inventory') { this.toggleGridInventoryModal(); return; } 
            if (action === 'show_market_menu') { this.showMarketMenu(); return; }
            if (action === 'market_list_item_select') { this.marketListItemSelect(); return; }
            if (action === 'list_item_for_sale_prompt') { this.promptListItemForSale(value); return; } 
            if (action === 'market_view_listings') { await this.showMarketListings(); return; }
            if (action === 'show_logged_in_menu') { this.showLoggedInMenu(); return; } 
            if (action === 'show_concoction_menu') { this.showConcoctionMenu(); return; } 
            if (action === 'prompt_concoct_quantity') { this.promptConcoctQuantity(value); return; } 


            if (!player && action !== 'logout') { displayMessage("Login required.", 'error'); this.showMainGate(); return; }
            if (player && !player.hasRolledSpiritualRoot && action !== 'logout') {
                displayMessage("You must first divine your spiritual roots!", "error"); this.showLoggedInMenu(); return;
            }
            if (player && !player.hasClassChosen && action !== 'logout' && action !== 'roll_spiritual_root') { 
                displayMessage("You must first choose your cultivation class!", "error"); this.showClassSelectionMenu(); return;
            }

            switch (action) {
                case 'meditate': player.meditate(); break; 
                case 'explore': await this.exploreArea(); break; 
                case 'view_stats': 
                    displayMessage("\n--- Stats ---", "system");
                    let sT = `N: ${player.name}\nClass: ${player.chosenClassName}\nR: ${player.getCultivationRealmName()}\nLvl: ${player.cultivationLevel}\nSpiritual Root: ${player.spiritualRootName} (x${player.spiritualRootMultiplier} cultivation speed)\nXP: ${player.cultivationProgress}/${player.getXPForNextLevel()}\nHP: ${player.health}/${player.maxHealth}\nQI: ${player.currentQi}/${player.maxQi}\nATK: ${player.getTotalAttack()}\nDEF: ${player.defense}\nSpirit Stones: ${player.resources.spiritStones || 0}${player.chosenClassKey === 'demon_cultivator' ? `\nDemonic Corruption: ${player.demonicCorruption}` : ''}\nSect: ${player.sectId && this.sects[player.sectId] ? this.sects[player.sectId].name : "None"}`;
                    displayMessage(sT); this.showLoggedInMenu(); break;
                case 'manage_sects': this.manageSects(); break;
                case 'pvp': await this.pvpChallenge(); break; 
                case 'logout': this.logout(); break;
                case 'combat_attack': if(this.currentCombat) await this.currentCombat.playerAction('attack'); break; 
                case 'combat_flee': if(this.currentCombat) await this.currentCombat.playerAction('flee'); break; 
                case 'combat_attempt_tame': if(this.currentCombat) await this.currentCombat.playerAction('attempt_tame'); break;
                case 'combat_use_talisman': if(this.currentCombat) await this.currentCombat.playerAction('use_talisman', value); break;
                case 'combat_use_item': if(this.currentCombat) await this.currentCombat.playerAction('use_combat_item', value); break; 
                case 'combat_devour_essence': if(this.currentCombat && this.currentCombat.postCombatAction === 'devour_essence_prompt') await Game.devourEssence(); break; 
                case 'forge_artifact': if(player.chosenClassKey === 'artifact_refiner') await Game.forgeArtifact(); break;
                case 'draw_talisman': if(player.chosenClassKey === 'talisman_master') await Game.drawTalisman(); break;
                case 'sect_create': await this.createSect(); break;
                case 'sect_view_all': this.viewAllSects(); break;
                case 'sect_join_prompt': await this.joinSectPrompt(); break;
                case 'sect_view_mine': this.viewMySectInfo(); break;
                case 'sect_leave': this.leaveMySect(); break; 
                case 'sect_back_to_main': this.showLoggedInMenu(); break;
                default: displayMessage("Unknown action.", 'error'); if(player) this.showLoggedInMenu(); else this.showMainGate();
            }
        } catch (e) { console.error(`Error in handlePlayerChoice (${action}):`, e); displayMessage("Action error.", "error"); if (Game.currentPlayerId) Game.showLoggedInMenu(); else Game.showMainGate(); }
    },
    async rollSpiritualRoot() { 
        const player = this.players[this.currentPlayerId];
        if (!player || player.hasRolledSpiritualRoot) return;
        const roll = Math.random() * 1000; 
        let rootName = "", multiplier = 1, qualityMessage = "";
        if (roll < 150) { rootName = "Five Spiritual Roots"; multiplier = 1; qualityMessage = "Common root, slow progress."; } 
        else if (roll < 400) { rootName = "Four Spiritual Roots"; multiplier = 2; qualityMessage = "Low talent, chaotic affinity."; } 
        else if (roll < 700) { rootName = "Three Spiritual Roots"; multiplier = 4; qualityMessage = "Average talent. Focus is key."; } 
        else if (roll < 900) { rootName = "Dual Spiritual Roots"; multiplier = 8; qualityMessage = "Good compatibility, balanced growth."; } 
        else if (roll < 980) { rootName = "Single Spiritual Root"; multiplier = 16; qualityMessage = "Extremely rare, high purity, fast cultivation!"; } 
        else if (roll < 995) { rootName = "Heavenly Spiritual Root"; multiplier = 32; qualityMessage = "Perfect harmony! Divine potential!"; } 
        else { rootName = "Chaos Spiritual Root"; multiplier = 64; qualityMessage = "Mythical root of immense power!";}
        player.spiritualRootName = rootName; player.spiritualRootMultiplier = multiplier; player.hasRolledSpiritualRoot = true;
        displayMessage(`\nSpiritual Roots: <span class="spiritual-root">${rootName}</span>!`, 'important');
        displayMessage(qualityMessage, 'narration'); displayMessage(`Cultivation speed x${multiplier}.`, 'success');
        
        await this.saveCurrentPlayerState(); 
        updateStatsDisplay(player); 
        this.showLoggedInMenu(); 
    },
    async createAccount() {
        try {
            displayMessage("\n--- Create Profile ---", 'system');
            const u = await getModalInput("Username:"); if (!u) { displayMessage("Cancelled.", "narration"); this.showMainGate(); return; }
            
            const qUsername = query(collection(db, "players"), where("username", "==", u));
            const existingUserQuery = await getDocs(qUsername);
            if (!existingUserQuery.empty) {
                displayMessage("This username is already taken. Please choose another.", 'error');
                this.showMainGate();
                return;
            }

            const p = await getModalInput("Password:", "password"); if (!p) { displayMessage("Cancelled.", "narration"); this.showMainGate(); return; }
            const n = await getModalInput("Cultivator Name:") || "Nameless One";
            
            const newPlayer = new Player(u,p,n); 
            this.players[newPlayer.playerId] = newPlayer; 
            this.currentPlayerId = newPlayer.playerId;

            await setDoc(doc(db, "players", newPlayer.playerId), newPlayer.toFirestoreObject());
            displayMessage(`\nWelcome, ${newPlayer.name}! Account created and saved.`, 'success'); 
            
            if (uiElements.chatInput) {
                uiElements.chatInput.disabled = false;
                uiElements.chatInput.placeholder = "Type your message...";
            }
            if (uiElements.chatSendButton) uiElements.chatSendButton.disabled = false;
            this.listenForChatMessages();
            this.showLoggedInMenu(); 
        } catch (e) { console.error("Create Account Error:", e); displayMessage("Account creation error. Check console.", "error"); this.showMainGate(); }
    },
    async login() {
        try {
            displayMessage("\n--- Login ---", 'system');
            const u = await getModalInput("Username:"); if (!u) { displayMessage("Cancelled.", "narration"); this.showMainGate(); return; }
            const p = await getModalInput("Password:", "password"); if (!p) { displayMessage("Cancelled.", "narration"); this.showMainGate(); return; }

            const qLogin = query(collection(db, "players"), where("username", "==", u));
            const playerQuery = await getDocs(qLogin);
            if (playerQuery.empty) {
                displayMessage("Invalid username or password.", 'error'); this.showMainGate(); return;
            }

            let foundPlayer = null;
            playerQuery.forEach(docSnap => { // docSnap, not doc
                const playerData = docSnap.data();
                if (playerData.password === p) { 
                    foundPlayer = Player.fromFirestoreObject(playerData); 
                    foundPlayer.playerId = docSnap.id; 
                }
            });

            if (foundPlayer) {
                this.players[foundPlayer.playerId] = foundPlayer; 
                this.currentPlayerId = foundPlayer.playerId;
                displayMessage(`Welcome back, ${foundPlayer.name}!`, 'success'); 
                
                if (uiElements.chatInput) {
                    uiElements.chatInput.disabled = false;
                    uiElements.chatInput.placeholder = "Type your message...";
                }
                if (uiElements.chatSendButton) uiElements.chatSendButton.disabled = false;
                this.listenForChatMessages();
                this.showLoggedInMenu(); 
            } else { 
                displayMessage("Invalid username or password.", 'error'); 
                this.showMainGate(); 
            }
        } catch (e) { console.error("Login Error:", e); displayMessage("Login error. Check console.", "error"); this.showMainGate(); }
    },
    logout() {
        if (this.currentPlayerId && this.players[this.currentPlayerId]) { displayMessage(`Safe travels, ${this.players[this.currentPlayerId].name}.`, 'narration'); }
        else { displayMessage("Logged out.", 'narration'); }
        
        this.stopListeningForChatMessages();
        if (uiElements.chatInput) {
            uiElements.chatInput.disabled = true;
            uiElements.chatInput.placeholder = "Login to chat...";
            uiElements.chatInput.value = '';
        }
        if (uiElements.chatSendButton) uiElements.chatSendButton.disabled = true;
        if (uiElements.chatLogContainer) uiElements.chatLogContainer.innerHTML = '';

        if (this.currentPlayerId) delete this.players[this.currentPlayerId]; 
        this.currentPlayerId = null; 
        this.showMainGate();
    },
    getMonster() {
        const player = this.players[this.currentPlayerId]; if (!player) { return new Monster("Lost Spirit",10,1,0,0,5); }
        const pl = player.cultivationLevel;
        const monsterTier = Game.getRealmTier(pl); 

        switch(monsterTier) {
            case 1: return new Monster("Rabid Wolf",30+pl*2,5+pl,1+Math.floor(pl/2), pl, 25+pl*2, true); 
            case 2: return new Monster("Forest Sprite", 50+pl*2.5, 8+pl, 3+Math.floor(pl/2), pl, 40+pl*2.5, true);
            case 3: return new Monster("Stone Golem",80+pl*3,10+pl,5+Math.floor(pl/2), pl, 50+pl*3, false); 
            case 4: return new Monster("Young Wyvern", 150+pl*4, 18+pl*1.5, 8+pl*0.75, pl, 100+pl*4, false);
            case 5: return new Monster("Demonic Cultivator Remnant", 220+pl*4.5, 22+pl*1.8, 10+pl*0.9, pl, 180+pl*4.5, false); 
            case 6: return new Monster("Ancient Guardian Spirit",300+pl*5,28+pl*2,15+pl, pl, 250+pl*5, false); 
            default: return new Monster("Mysterious Entity", 100+pl*3, 10+pl, 5+pl, pl, 75+pl*3);
        }
    },
    async exploreArea() { 
        const player = this.players[this.currentPlayerId]; if (!player) {this.showMainGate(); return;}
        if (!player.isAlive()) { displayMessage("Too weak to explore.", 'error'); this.showLoggedInMenu(); return; }
        
        let foundSomething = false;
        displayMessage("\nVenturing into the wilderness...", 'narration');

        const playerRealmTier = Game.getRealmTier(player.cultivationLevel);
        const potentialHerbDrops = Game.REALM_HERB_DROPS[playerRealmTier] || [];
        let itemsFoundThisExplore = []; 

        if (Math.random() < 0.45) { 
            potentialHerbDrops.forEach(herbDrop => {
                let effectiveChance = herbDrop.chance;
                if (Game.ITEM_DATA[herbDrop.itemId] && Game.ITEM_DATA[herbDrop.itemId].forRealmBreak) {
                    const targetBreakTier = Game.ITEM_DATA[herbDrop.itemId].forRealmBreak;
                    if (targetBreakTier > playerRealmTier) effectiveChance *= 0.5; 
                    else if (targetBreakTier < playerRealmTier) effectiveChance *= 0.3;
                }
                if (Math.random() < effectiveChance) {
                    const quantity = Math.floor(Math.random() * (herbDrop.maxQuantity - herbDrop.minQuantity + 1)) + herbDrop.minQuantity;
                    player.resources[herbDrop.itemId] = (player.resources[herbDrop.itemId] || 0) + quantity;
                    itemsFoundThisExplore.push(`${Game.ITEM_DATA[herbDrop.itemId].name} (x${quantity})`);
                    foundSomething = true;
                }
            });
        }
        
        if (Math.random() < 0.08) { 
            const allRecipeItemKeys = Object.keys(Game.ITEM_DATA).filter(k => Game.ITEM_DATA[k].type === 'recipe');
            const eligibleRecipes = allRecipeItemKeys.filter(recipeItemKey => {
                const recipeKey = Game.ITEM_DATA[recipeItemKey].learnsRecipeKey;
                const pillRecipe = Game.PILL_RECIPES[recipeKey];
                return player.cultivationLevel >= (pillRecipe.requiredCultivationLevel - 5) && player.cultivationLevel <= (pillRecipe.requiredCultivationLevel + 10);
            });

            if (eligibleRecipes.length > 0) {
                const randomRecipeKey = eligibleRecipes[Math.floor(Math.random() * eligibleRecipes.length)];
                if (!player.resources[randomRecipeKey] || player.resources[randomRecipeKey] < 1) { 
                     player.resources[randomRecipeKey] = (player.resources[randomRecipeKey] || 0) + 1;
                     itemsFoundThisExplore.push(`${Game.ITEM_DATA[randomRecipeKey].name}`);
                     foundSomething = true;
                }
            }
        }


        if (Math.random() < 0.2) { 
            const stonesFound = Math.floor(Math.random() * 2) + 1; 
            player.resources.spiritStones = (player.resources.spiritStones || 0) + stonesFound;
            itemsFoundThisExplore.push(`${stonesFound} Spirit Stone(s)`);
            foundSomething = true;
        }
        if (player.chosenClassKey === 'alchemist' && Math.random() < 0.15) { 
            player.resources.jadeleafGrass = (player.resources.jadeleafGrass || 0) + 1; 
            itemsFoundThisExplore.push("an extra Jadeleaf Grass (Alchemist bonus)");
            foundSomething = true;
        }

        if(itemsFoundThisExplore.length > 0) {
             displayMessage(`You found: ${itemsFoundThisExplore.join(', ')}!`, "loot");
        }


        if(foundSomething) {
            updateStatsDisplay(player); 
            await this.saveCurrentPlayerState();
        }

         if (player.chosenClassKey === 'poison_master' && Math.random() < 0.3) { 
            displayMessage("\nYou sense an opportunity to use your stealth...", 'narration');
            const choice = await getModalInput("Attempt a Stealthy Approach? (yes/no)");
            if (choice && choice.toLowerCase() === 'yes') {
                if (Math.random() < 0.7) { 
                    displayMessage("Your stealthy approach was successful! You avoid any immediate danger and gain some insight.", 'success');
                    player.gainCultivationXP(Math.floor(Math.random() * 5) + 3); 
                    this.showLoggedInMenu();
                    return;
                } else {
                    displayMessage("Your stealth attempt failed! A creature noticed you!", 'error');
                }
            } else {
                displayMessage("You decide against stealth.", 'narration');
            }
        }
        
        if (Math.random() < 0.7) { 
            await this.startCombat(player, this.getMonster()); 
        } else {
            if (!foundSomething) { 
                 displayMessage("The area is quiet. You find a moment to reflect.", 'narration');
            }
            const baseXp = Math.floor(Math.random()*(5+player.cultivationLevel))+5;
            displayMessage(`Gained insights from your surroundings.`, 'success'); 
            player.gainCultivationXP(baseXp); 
            this.showLoggedInMenu();
        }
    },
    async startCombat(player, opponent) { 
        this.currentGameState = 'COMBAT'; 
        uiElements.combatInterface.style.display = 'block';
        uiElements.actionButtonsContainer.innerHTML = ''; 
        uiElements.combatActionText.innerHTML = ''; 
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none';

        displayMessage(`Encounter: ${opponent.name} (${opponent.getCultivationRealmName()})`, 'important'); 
        updateCombatUI(player, opponent);
        this.currentCombat = {
            player: player, opponent: opponent, turn: 'player', postCombatAction: null,
            playerAction: async function(action, itemKey) { 
                if (this.turn!=='player' || !this.player.isAlive() || !this.opponent.isAlive()) return;
                if (action==='attack') {
                    this.player.attackTarget(this.opponent); 
                } else if (action==='flee') {
                    displayCombatAction("Attempting to flee...", 'combat-text-narration'); 
                    if (Math.random()<0.5) { 
                        displayMessage("Fled successfully!",'success'); 
                        Game.currentCombat=null; Game.showLoggedInMenu(); return; 
                    } else {
                        appendCombatAction("Failed to flee!", 'combat-text-opponent-action'); 
                    }
                } else if (action === 'attempt_tame') {
                    displayCombatAction(`${player.name} attempts to tame the ${opponent.name}...`, 'combat-text-player-action');
                    if (player.currentQi >= 15) {
                        player.currentQi -= 15; 
                        appendCombatAction(`The ${opponent.name} seems wary... (Taming WIP)`, 'combat-text-narration');
                    } else {
                        appendCombatAction("Not enough QI to attempt taming!", 'error');
                    }
                    updateStatsDisplay(player); Game.saveCurrentPlayerState();
                } else if (action === 'use_talisman') {
                    const talismanData = Game.ITEM_DATA[itemKey];
                    if (player.resources[itemKey] > 0 && talismanData && talismanData.effectInCombat) {
                        if (talismanData.effectInCombat(player, this.opponent)) { 
                            player.resources[itemKey]--;
                            updateStatsDisplay(player); 
                        }
                    } else {
                        appendCombatAction("Cannot use this talisman now.", "error");
                    }
                } else if (action === 'use_combat_item') { 
                     const combatItemData = Game.ITEM_DATA[itemKey];
                     if (player.resources[itemKey] > 0 && combatItemData && combatItemData.usableInCombat && typeof combatItemData.effect === 'function') {
                         combatItemData.effect(player); 
                     } else {
                         appendCombatAction("Cannot use this item now.", "error");
                         this.promptPlayerAction(); 
                         return;
                     }
                }
                else { 
                    displayCombatAction("Invalid action.",'error'); 
                    this.promptPlayerAction(); return; 
                }
                
                if (!this.opponent.isAlive()) {
                    await this.endCombat(true); 
                } else { 
                    this.turn='opponent'; 
                    setTimeout(()=>this.opponentTurn(), 1000); 
                }
            },
            opponentTurn: async function() { 
                if (this.turn!=='opponent' || !this.opponent.isAlive() || !this.player.isAlive()) return;
                displayCombatAction(`--- ${this.opponent.name}'s Turn ---`, 'combat-text-opponent-turn');
                setTimeout(async () => { 
                   this.opponent.attackTarget(this.player); 
                   if (!this.player.isAlive()) {
                       await this.endCombat(false); 
                   } else { 
                       this.turn='player'; 
                       this.promptPlayerAction(); 
                   }
                }, 1000); 
            },
            promptPlayerAction: function() {
                if (!this.player.isAlive() || !this.opponent.isAlive()) return; 
                displayCombatAction(`--- Your Turn ---`, 'combat-text-player-turn'); 
                let combatActions = [
                    { text: "Attack", action: "combat_attack", style: "danger" },
                ];

                const player = Game.players[Game.currentPlayerId];
                for (const itemKey in player.resources) {
                    if (player.resources[itemKey] > 0 && Game.ITEM_DATA[itemKey] && Game.ITEM_DATA[itemKey].usableInCombat) {
                        const item = Game.ITEM_DATA[itemKey];
                        if (item.type === 'talisman') {
                             combatActions.push({ text: `Use ${item.name} (x${player.resources[itemKey]})`, action: 'combat_use_talisman', value: itemKey, style: 'special'});
                        } else if (item.type === 'consumable') { 
                            combatActions.push({ text: `Use ${item.name} (x${player.resources[itemKey]})`, action: 'combat_use_item', value: itemKey, style: 'confirm'});
                        }
                    }
                }

                if (player.chosenClassKey === 'beast_tamer' && this.opponent.tamable) {
                    combatActions.push({ text: "Attempt Tame (15 QI)", action: "combat_attempt_tame", style: "special" });
                }
                 combatActions.push({ text: "Flee", action: "combat_flee", style: "neutral" }); 
                populateActionButtons(combatActions, uiElements.combatSpecificActions); 
            },
            endCombat: async function(playerWon) { 
                uiElements.combatInterface.style.display = 'none'; 
                uiElements.combatSpecificActions.innerHTML = ''; 
                const player = this.player; 
                if (playerWon) {
                    displayMessage(`${this.opponent.name} slain!`, 'success'); 
                    
                    let baseXp = this.opponent.xpReward || 0;
                    
                    if (player.chosenClassKey === 'heavenly_oracle' && Math.random() < 0.2) { 
                        const bonusXpOracle = Math.floor(baseXp * 0.15); 
                        baseXp += bonusXpOracle;
                        displayMessage("A Glimpse of Fortune blesses you with extra insight!", 'spiritual-root');
                    }
                    if (baseXp > 0) player.gainCultivationXP(baseXp); 

                    let lootFoundMessage = []; 
                    if (this.opponent instanceof Monster) {
                        const droppedLoot = this.opponent.getLootDrops(player);
                        droppedLoot.forEach(lootItem => {
                            player.resources[lootItem.itemId] = (player.resources[lootItem.itemId] || 0) + lootItem.quantity;
                            lootFoundMessage.push(`${Game.ITEM_DATA[lootItem.itemId].name} (x${lootItem.quantity})`);
                        });
                    }


                    if(lootFoundMessage.length > 0) {
                        displayMessage(`Loot: ${lootFoundMessage.join(', ')}!`, "loot");
                        updateStatsDisplay(player); 
                    }


                    if (this.opponent instanceof Player) displayMessage("Duel victory! Reputation grows.", 'success');

                    if (player.chosenClassKey === 'demon_cultivator') {
                        displayMessage("The defeated foe's essence lingers... A dark opportunity presents itself.", 'demonic');
                        this.postCombatAction = 'devour_essence_prompt'; 
                        populateActionButtons([
                            { text: "Devour Essence", action: "combat_devour_essence", style: "danger" },
                            { text: "Ignore", action: "show_logged_in_menu", style: "neutral" } 
                        ], uiElements.actionButtonsContainer);
                        await Game.saveCurrentPlayerState(); 
                        return; 
                    }

                } else { 
                    displayMessage("Defeated...", 'error'); 
                    player.health = 1; 
                    displayMessage("Awakened, weakened.", 'narration');
                    if (this.opponent instanceof Player) { 
                        player.cultivationProgress = Math.max(0, player.cultivationProgress - 20);
                        displayMessage("Humbling duel loss.", 'narration');
                    }
                }
                await Game.saveCurrentPlayerState(); 
                updateStatsDisplay(player); 
                Game.currentCombat=null; 
                Game.showLoggedInMenu();
            }
        };
        this.currentCombat.promptPlayerAction(); 
    },
    async devourEssence() {
        const player = this.players[this.currentPlayerId];
        if (!player || player.chosenClassKey !== 'demon_cultivator') return;

        const bonusXp = Math.floor(Math.random() * 20) + 10; 
        const corruptionGain = Math.floor(Math.random() * 3) + 1; 

        player.demonicCorruption = (player.demonicCorruption || 0) + corruptionGain;
        displayMessage(`You devour the lingering essence, gaining ${bonusXp} bonus Cultivation XP!`, 'demonic');
        displayMessage(`Your Demonic Corruption increases by ${corruptionGain}. Total: ${player.demonicCorruption}`, 'demonic');
        player.gainCultivationXP(bonusXp); 

        Game.currentCombat.postCombatAction = null; 
        this.showLoggedInMenu(); 
    },
    async forgeArtifact() { 
        const player = this.players[this.currentPlayerId];
        if (!player || player.chosenClassKey !== 'artifact_refiner') return;
        displayMessage("\nAttempting to forge an artifact...", "narration");
        if ((player.resources.roughIronOre || 0) >= 3 && player.currentQi >= 15) {
            player.resources.roughIronOre -= 3;
            player.currentQi -= 15;
            player.resources.roughSword = (player.resources.roughSword || 0) + 1;
            displayMessage("Successfully forged a Rough Sword!", "success");
            updateStatsDisplay(player); 
        } else {
            displayMessage("Not enough Rough Iron Ore (need 3) or QI (need 15).", "error");
        }
        await this.saveCurrentPlayerState();
        this.showLoggedInMenu();
    },
    async drawTalisman() { 
        const player = this.players[this.currentPlayerId];
        if (!player || player.chosenClassKey !== 'talisman_master') return;
        displayMessage("\nAttempting to draw a talisman...", "narration");
        if ((player.resources.blankTalismanPaper || 0) >= 1 && player.currentQi >= 5) {
            player.resources.blankTalismanPaper -= 1;
            player.currentQi -= 5;
            player.resources.minorFireTalisman = (player.resources.minorFireTalisman || 0) + 1;
            displayMessage("Successfully drew a Minor Fire Talisman!", "success");
            updateStatsDisplay(player); 
        } else {
            displayMessage("Not enough Blank Talisman Paper (need 1) or QI (need 5).", "error");
        }
        await this.saveCurrentPlayerState();
        this.showLoggedInMenu();
    },
    manageSects() { 
        this.currentGameState = 'SECT_MANAGEMENT'; uiElements.combatInterface.style.display = 'none';
        uiElements.concoctionMenuDiv.style.display = 'none';
        uiElements.combatSpecificActions.innerHTML = ''; 
        if(uiElements.gridInventoryModal) uiElements.gridInventoryModal.style.display = 'none';

        const player = this.players[this.currentPlayerId]; if (!player) { this.showMainGate(); return; }
        displayMessage("\n--- Sect Hall ---", 'system');
        if (player.sectId && this.sects[player.sectId]) { displayMessage(`Member of: ${this.sects[player.sectId].name}`, 'narration'); }
        else { displayMessage("Not in a sect.", 'narration'); }
        const actions = [
            { text: "Create Sect", action: "sect_create", style: "confirm" }, { text: "View Sects", action: "sect_view_all" },
            { text: "Join Sect (ID)", action: "sect_join_prompt" } ];
        if (player.sectId) {
            actions.push({ text: "My Sect Info", action: "sect_view_mine", style: "special" });
            actions.push({ text: "Leave Sect", action: "sect_leave", style: "danger" });
        }
        actions.push({ text: "Back to Menu", action: "sect_back_to_main", style: "neutral" });
        populateActionButtons(actions, uiElements.actionButtonsContainer); 
    },
    async createSect() { 
        const player = this.players[this.currentPlayerId]; if (!player) {this.showMainGate(); return;}
        try {
            if (player.sectId) { displayMessage("Must leave current sect.", 'error'); this.manageSects(); return; }
            if (player.cultivationLevel < 10) { displayMessage("Need Foundation Establishment (Level 10).", 'error'); this.manageSects(); return; } 
            const n = await getModalInput("Sect Name:"); if (!n) { displayMessage("Cancelled.", "narration"); this.manageSects(); return; }
            if (Object.values(this.sects).some(s=>s.name===n)) { displayMessage("Name taken.",'error');this.manageSects();return; }
            const d = await getModalInput("Sect Description:") || "A mysterious sect.";
            const nS = new Sect(n,player.playerId,d); this.sects[nS.sectId]=nS; player.joinSect(nS.sectId); 
            displayMessage(`Sect '${n}' established!`, 'success');
        } catch (e) { console.error("Create Sect Error:", e); displayMessage("Sect creation error.", "error"); }
        this.manageSects();
    },
    viewAllSects() { 
        if (Object.keys(this.sects).length===0) { displayMessage("No sects yet.",'narration'); }
        else { displayMessage("\n--- Available Sects ---", 'system');
            Object.values(this.sects).forEach(s => {
                const fN = (this.players[s.founderId] && this.players[s.founderId].name) ? this.players[s.founderId].name : 'Unknown Founder'; 
                displayMessage(`ID: ${s.sectId} | Name: ${s.name} | Founder: ${fN} | Members: ${s.members.size}`); });
        } this.manageSects(); 
    },
    async joinSectPrompt() { 
        const player = this.players[this.currentPlayerId]; if (!player) {this.showMainGate(); return;}
        try {
            if (player.sectId) { displayMessage("Already in a sect.", 'error'); this.manageSects(); return; }
            if (Object.keys(this.sects).length === 0) { displayMessage("No sects to join.", 'narration'); this.manageSects(); return; }
            const id = await getModalInput("Sect ID to join:"); if (!id) { displayMessage("Cancelled.", "narration"); this.manageSects(); return; }
            if (this.sects[id]) player.joinSect(id); 
            else displayMessage("Invalid ID.", 'error');
        } catch (e) { console.error("Join Sect Error:", e); displayMessage("Join sect error.", "error"); }
        this.manageSects();
    },
    viewMySectInfo() { 
        const player = this.players[this.currentPlayerId]; if (!player) {this.showMainGate(); return;}
        if (player.sectId && this.sects[player.sectId]) {
            const s = this.sects[player.sectId]; displayMessage(`\n--- Sect: ${s.name} ---`, 'system');
            displayMessage(`Description: ${s.description}`); 
            const fN = (this.players[s.founderId] && this.players[s.founderId].name) ? this.players[s.founderId].name : 'Unknown Founder';
            displayMessage(`Founder: ${fN}`); displayMessage("Members:");
            if (s.members.size > 0) { s.members.forEach(mId => { const m=this.players[mId]; if(m)displayMessage(`- ${m.name} (${m.getCultivationRealmName()})`); });}
            else displayMessage("No other members yet.");
        } else displayMessage("Not in a sect.", 'error'); this.manageSects();
    },
    leaveMySect() { const player = this.players[this.currentPlayerId]; if (!player) {this.showMainGate(); return;} player.leaveSect(); this.manageSects(); }, 
    async pvpChallenge() { 
        const player = this.players[this.currentPlayerId]; if (!player) {this.showMainGate(); return;}
        if (!player.isAlive()) { displayMessage("Too weak for duel.", 'error'); this.showLoggedInMenu(); return; }
        const rL = Math.max(1, player.cultivationLevel + (Math.floor(Math.random()*5)-2)); 
        const rNs = ["Shadow Lin", "Azure Fang", "Silent Gao", "Crimson Hua", "Iron Fist Zhao"];
        const rN = rNs[Math.floor(Math.random()*rNs.length)];
        const rival = new Player("rival_" + generateFirestoreId("players_rivals"), "p", rN); 
        rival.cultivationLevel=rL;
        rival.maxHealth=80+rL*20; rival.health=rival.maxHealth; rival.attack=8+rL*5; rival.defense=4+rL*2;
        rival.maxQi = 40 + rL * 8; rival.currentQi = rival.maxQi;
        rival.resources.spiritStones = Math.floor(Math.random() * (rL * 5)); 

        displayMessage(`\nRival ${rival.name} (${rival.getCultivationRealmName()}) challenges you to a duel!`, 'important'); 
        await this.startCombat(player, rival); 
    },

    async sendChatMessage(messageText) {
        if (!this.currentPlayerId || !this.players[this.currentPlayerId]) {
            console.error("No current player to send chat message.");
            displayMessage("You must be logged in to chat.", "error");
            return;
        }
        if (!messageText || messageText.length > 200) { 
            displayMessage("Message is empty or too long (max 200 chars).", "error");
            return;
        }

        const player = this.players[this.currentPlayerId];
        const messageData = {
            senderId: player.playerId,
            senderName: player.name,
            text: messageText,
            timestamp: fsServerTimestamp()
        };

        try {
            await addDoc(collection(db, "chatMessages"), messageData);
        } catch (error) {
            console.error("Error sending chat message:", error);
            displayMessage("Failed to send message. Check connection.", "error");
        }
    },

    listenForChatMessages() {
        if (this.chatMessagesListener) { 
            this.chatMessagesListener(); 
        }

        const qChat = query(collection(db, "chatMessages"), orderBy("timestamp", "asc"), limitToLast(MAX_CHAT_MESSAGES_DISPLAYED));
        this.chatMessagesListener = onSnapshot(qChat, querySnapshot => {
            if (uiElements.chatLogContainer) uiElements.chatLogContainer.innerHTML = ''; 
            querySnapshot.forEach(docSnap => { // docSnap
                const msgData = docSnap.data();
                if (msgData.timestamp) { 
                     displayChatMessage(msgData); 
                }
            });
        }, error => {
            console.error("Error listening to chat messages:", error);
            displayMessage("Chat connection error.", "error");
        });
    },

    stopListeningForChatMessages() {
        if (this.chatMessagesListener) {
            this.chatMessagesListener(); 
            this.chatMessagesListener = null;
            console.log("Stopped listening for chat messages.");
        }
    },
    loadPillDataFromCSV(csvData) {
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',');

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const elixirName = values[0];
            const ingredientsStr = values[1];
            const useDescription = values[2];

            const recipeKey = toCamelCase(elixirName);
            const pillItemKey = recipeKey + "Item"; 
            const recipeItemKey = recipeKey + "Recipe"; 

            const ingredients = {};
            ingredientsStr.split(' + ').forEach(ingFull => {
                const ingName = ingFull.trim();
                const ingKey = toCamelCase(ingName);
                if (Game.ITEM_DATA[ingKey]) { 
                    ingredients[ingKey] = (ingredients[ingKey] || 0) + 1;
                } else {
                    console.warn(`Unknown ingredient '${ingName}' (key: '${ingKey}') for pill '${elixirName}'. Define in ITEM_DATA.`);
                     if (!Game.ITEM_DATA[ingKey]) { // Ensure gameAsset is updated to new path convention
                        Game.ITEM_DATA[ingKey] = { name: ingName, description: `Herb for alchemy: ${ingName}.`, type: "material", tier: 1, gameAsset: 'herb.png' }; 
                        console.log(`Fallback: Created basic material for ${ingName} as ${ingKey}`);
                    }
                    ingredients[ingKey] = (ingredients[ingKey] || 0) + 1;
                }
            });
            
            let qiCost = 5 + Object.keys(ingredients).length * 3 + (elixirName.length / 2); 
            let requiredLevel = 1; 
            
            if (elixirName === "Foundation Establishment Pill") requiredLevel = 9; 
            else if (elixirName === "Golden Core Nine Revolutions Pill") requiredLevel = 18;
            else if (elixirName === "Nascent Soul Unification Pill") requiredLevel = 27;
            else if (elixirName === "Soul Formation Heaven Pill") requiredLevel = 36;
            else if (elixirName === "Transcendence Void Elixir") requiredLevel = 45;
            else if (elixirName.includes("Advanced") || elixirName.includes("Core")) requiredLevel = 19; 
            else if (elixirName.includes("Nascent Soul")) requiredLevel = 28; 
            else if (useDescription.toLowerCase().includes("core cultivators")) requiredLevel = 19;
            else if (useDescription.toLowerCase().includes("nascent soul")) requiredLevel = 28;


            Game.PILL_RECIPES[recipeKey] = {
                name: elixirName,
                recipeKey: recipeKey,
                ingredients: ingredients,
                producesItemKey: pillItemKey,
                productName: elixirName,
                useDescription: useDescription,
                qiCost: Math.floor(qiCost),
                requiredCultivationLevel: requiredLevel, 
                isBasic: elixirName === "Basic Qi Recovery Pill"
            };

            if (!Game.ITEM_DATA[pillItemKey]) {
                let isBreakthroughPill = (
                    elixirName === "Foundation Establishment Pill" ||
                    elixirName === "Golden Core Nine Revolutions Pill" ||
                    elixirName === "Nascent Soul Unification Pill" ||
                    elixirName === "Soul Formation Heaven Pill" ||
                    elixirName === "Transcendence Void Elixir"
                );
                let isPermanentStatPill = (
                    elixirName === "Starforge Strength Pill" ||
                    elixirName === "Agility Surge Pill"
                );

                Game.ITEM_DATA[pillItemKey] = {
                    name: elixirName,
                    description: useDescription,
                    type: "consumable",
                    gameAsset: 'elixir.png', 
                    effect: function(player) { 
                        displayMessage(`Using ${this.name}...`, "item-use");
                        let healed = 0, qiRestored = 0, tempAttack = 0, tempDefense = 0;
                        let itemUsedSuccessfully = false; 
                        
                        if (elixirName === "Foundation Establishment Pill") {
                            if (player.cultivationLevel === 9 && player.cultivationProgress >= player.getXPForNextLevel()) {
                                player._performMajorBreakthrough(10, "Foundation Establishment");
                                itemUsedSuccessfully = true;
                            } else {
                                displayMessage("You are not ready for this breakthrough. Reach Level 9 with full cultivation progress.", "error");
                            }
                        } else if (elixirName === "Golden Core Nine Revolutions Pill") {
                            if (player.cultivationLevel === 18 && player.cultivationProgress >= player.getXPForNextLevel()) {
                                player._performMajorBreakthrough(19, "Core Formation");
                                itemUsedSuccessfully = true;
                            } else {
                                displayMessage("You are not ready for this breakthrough. Reach Level 18 with full cultivation progress.", "error");
                            }
                        } else if (elixirName === "Nascent Soul Unification Pill") {
                             if (player.cultivationLevel === 27 && player.cultivationProgress >= player.getXPForNextLevel()) {
                                player._performMajorBreakthrough(28, "Nascent Soul");
                                itemUsedSuccessfully = true;
                            } else {
                                displayMessage("You are not ready for this breakthrough. Reach Level 27 with full cultivation progress.", "error");
                            }
                        } else if (elixirName === "Soul Formation Heaven Pill") {
                             if (player.cultivationLevel === 36 && player.cultivationProgress >= player.getXPForNextLevel()) {
                                player._performMajorBreakthrough(37, "Soul Formation");
                                itemUsedSuccessfully = true;
                            } else {
                                displayMessage("You are not ready for this breakthrough. Reach Level 36 with full cultivation progress.", "error");
                            }
                        } else if (elixirName === "Transcendence Void Elixir") {
                             if (player.cultivationLevel === 45 && player.cultivationProgress >= player.getXPForNextLevel()) {
                                player._performMajorBreakthrough(46, "Transcendent");
                                itemUsedSuccessfully = true;
                            } else {
                                displayMessage("You are not ready for this breakthrough. Reach Level 45 with full cultivation progress.", "error");
                            }
                        } 
                        else if (this.name === "Basic Qi Recovery Pill") { qiRestored = 20 + Math.floor(player.cultivationLevel / 2); itemUsedSuccessfully = true; }
                        else if (this.name === "Vitality Rejuvenation Pill") { healed = 40 + player.cultivationLevel; player.currentQi = Math.min(player.maxQi, player.currentQi + 10); itemUsedSuccessfully = true;} 
                        else if (this.name === "Mind-Calming Elixir") { player.currentQi = Math.min(player.maxQi, player.currentQi + 15); itemUsedSuccessfully = true;}
                        else if (this.name === "Advanced Spirit Pill") { qiRestored = 100 + player.cultivationLevel * 2; healed = 20; itemUsedSuccessfully = true;}
                        else if (this.name === "Nascent Soul Vital Pill") { qiRestored = 200 + player.cultivationLevel * 3; healed = 150 + player.cultivationLevel * 2; itemUsedSuccessfully = true;}
                        else if (this.name === "Starforge Strength Pill") { player.attack += 1; displayMessage("Your physical strength permanently increases by 1!", "success"); itemUsedSuccessfully = true;} 
                        else if (this.name === "Agility Surge Pill") { player.defense += 1; displayMessage("Your agility (defense) permanently increases by 1!", "success"); itemUsedSuccessfully = true;} 
                        else if (this.name === "Spirit-Eye Elixir") { qiRestored = 25; itemUsedSuccessfully = true;}
                        else if (this.name === "Flame Infusion Pill") { tempAttack = 5; displayMessage("You feel a fiery surge!", "item-use"); itemUsedSuccessfully = true;} 
                        else if (this.name === "Balance Harmonization Pill") { qiRestored = 30; healed = 10; displayMessage("Your Qi feels more harmonious.", "item-use"); itemUsedSuccessfully = true;}


                        if (healed > 0) { player.health = Math.min(player.maxHealth, player.health + healed); displayMessage(`Restored ${healed} HP.`, "success"); }
                        if (qiRestored > 0) { player.currentQi = Math.min(player.maxQi, player.currentQi + qiRestored); displayMessage(`Restored ${qiRestored} QI.`, "qi-recovery"); }
                        
                        if (itemUsedSuccessfully) {
                            player.resources[pillItemKey]--; 
                        }
                    },
                    usableInCombat: !(isBreakthroughPill || isPermanentStatPill)
                };
            }

            if (elixirName !== "Basic Qi Recovery Pill" && !Game.ITEM_DATA[recipeItemKey]) {
                Game.ITEM_DATA[recipeItemKey] = {
                    name: `Recipe: ${elixirName}`,
                    description: `Teaches the method to concoct ${elixirName}. Ingredients: ${ingredientsStr.replace(/\s\+\s/g, ', ')}.`,
                    type: "recipe",
                    gameAsset: 'recipe.png', 
                    learnsRecipeKey: recipeKey, 
                    effect: function(player) { 
                        if (!player.knownRecipes) player.knownRecipes = [];
                        const recipeKeyToLearn = this.learnsRecipeKey; 
                        if (!player.knownRecipes.includes(recipeKeyToLearn)) {
                            player.knownRecipes.push(recipeKeyToLearn);
                            displayMessage(`You learned the recipe for ${Game.PILL_RECIPES[recipeKeyToLearn].name}!`, "success");
                        } else {
                            displayMessage(`You already know the recipe for ${Game.PILL_RECIPES[recipeKeyToLearn].name}.`, "narration");
                        }
                        player.resources[recipeItemKey]--; 
                    }
                };
            }
        }
    }
}; 

const pillCsvData = `Elixir Name,Ingredients,Use
Basic Qi Recovery Pill,Jadeleaf Grass + Crimson Spirit Berry,Restores a small amount of Qi for Qi Refining cultivators.
Vitality Rejuvenation Pill,Moondew Flower + Earthroot Ginseng,Heals minor injuries and restores stamina quickly.
Mind-Calming Elixir,Soothing Rain Petal + Whispering Leaf,Clears mental fatigue and stabilizes Qi flow.
Advanced Spirit Pill,Sky Lotus Bud + Spiritglow Mushroom,Restores large amounts of Qi and spiritual health for Core cultivators.
Nascent Soul Vital Pill,Cloudmoss Vine + Radiant Sunfruit,High-grade healing and Qi replenishment for Nascent Soul stage cultivators.
Foundation Establishment Pill,Breakthrough Vine + Soothing Rain Petal,Assists Qi Refining cultivators in establishing a stable foundation.
Golden Core Nine Revolutions Pill,Dragonbone Fern + Spiritglow Mushroom + Earthroot Ginseng,Supports the formation of a perfect golden core with enhanced spiritual potential.
Nascent Soul Unification Pill,Phoenixblood Herb + Ascension Orchid,Facilitates smooth transition from Core Formation to Nascent Soul realm.
Soul Formation Heaven Pill,Heavenpierce Root + Lunar Bloom,Required to survive the soul tribulation and form the divine soul.
Transcendence Void Elixir,Voidberry Thorn + ImmortalDustleaf,Enables Soul Formation experts to ascend to the Transcendent realm.
Starforge Strength Pill,Starforge Petal + Stoneheart Root,Permanently increases physical strength and endurance.
Spirit-Eye Elixir,Spirit-Eye Flower + Heartblossom Bud,"Improves spiritual perception, range of sight, and soul awareness."
Agility Surge Pill,Silverstorm Leaf + GoldenDantian Fruit,Boosts movement speed and cultivator evasion skills.
Flame Infusion Pill,Blackflame Ginseng + Frostmarrow Moss,Enhances fire affinity and provides resistance to ice and soul damage.
Balance Harmonization Pill,Harmonizing Bellvine + Eye of the Ancients,Balances chaotic elemental Qi and enhances technique comprehension.`;

// Make Game object globally accessible for inline HTML onclicks
// This is a temporary measure for easier migration. Ideally, all event listeners
// should be set up in JavaScript.
window.Game = Game;
```
