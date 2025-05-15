import './style.css';
import { Game } from './gameLogic.js'; // Game object is now exported from gameLogic.js
import { uiElements, modalResolve as getUiModalResolve, setModalResolve as setUiModalResolve } from './ui.js'; // Import UI elements and modal resolver

// --- START: FRONTEND UI JAVASCRIPT (Event Listeners) ---

// Modal Event Listeners
uiElements.modalSubmitButton.onclick = () => {
    try {
        const currentModalResolve = getUiModalResolve(); // Get current resolver
        if (currentModalResolve) {
            const value = uiElements.modalPasswordInputField.style.display === 'none' ? uiElements.modalInputField.value : uiElements.modalPasswordInputField.value;
            currentModalResolve(value.trim()); 
        }
    } catch (error) { 
        console.error("Error in modalSubmitButton:", error); 
        const currentModalResolve = getUiModalResolve();
        if (currentModalResolve) currentModalResolve(null); 
    } 
    finally { 
        if (uiElements.inputModal) uiElements.inputModal.style.display = 'none'; 
        setUiModalResolve(null); // Clear resolver
    }
};

uiElements.modalCancelButton.onclick = () => {
    try { 
        const currentModalResolve = getUiModalResolve();
        if (currentModalResolve) { currentModalResolve(null); } 
    } 
    catch (error) { console.error("Error in modalCancelButton:", error); } 
    finally { 
        if (uiElements.inputModal) uiElements.inputModal.style.display = 'none'; 
        setUiModalResolve(null); 
    }
};

// Inventory Modal Close Button
if (uiElements.closeInventoryModalButton) {
    uiElements.closeInventoryModalButton.onclick = () => Game.toggleGridInventoryModal();
}

// Chat Event Listeners
if (uiElements.chatSendButton) {
    uiElements.chatSendButton.onclick = () => {
        const messageText = uiElements.chatInput.value.trim();
        if (messageText && Game.currentPlayerId && !uiElements.chatSendButton.disabled) {
            Game.sendChatMessage(messageText);
            uiElements.chatInput.value = '';
        }
    };
}

if (uiElements.chatInput) {
    uiElements.chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !uiElements.chatInput.disabled) {
            event.preventDefault(); 
            uiElements.chatSendButton.click();
        }
    });
}
// --- END: FRONTEND UI JAVASCRIPT (Event Listeners) ---


// Initialize the game when the window loads
window.onload = () => {
    try { 
        Game.initializeGame(); 
    } catch (e) { 
        console.error("Initialization Error:", e); 
        if(document.body) document.body.innerHTML = '<div style="color:red;padding:20px;font-size:18px;text-align:center;">A fatal error occurred during game initialization. Please check the console (F12) for details and try reloading.</div>';
    }
};

// Make Game globally accessible for inline HTML onclicks
window.Game = Game;