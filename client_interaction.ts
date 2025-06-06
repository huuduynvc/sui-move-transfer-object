import {
    SuiClient,
    getFullnodeUrl,
} from '@mysten/sui/client';
import {
    Ed25519Keypair
} from '@mysten/sui/keypairs/ed25519';
import {
    Transaction
} from '@mysten/sui/transactions';
import {
    fromB64
} from '@mysten/sui/utils'; // Common utilities
import * as dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env file

// --- Configuration ---
const PACKAGE_ID = '0x88640e3410b1feaefa3e6a56e97699b8efbe4cd1f15297632e17c879b0a532ba';
const TREASURY_ID = '0x9e7c71a9239cf7e7a1b966e18d0bb10636e41fee590f90946aa5fba62bd76aaa'; // Shared Treasury Object ID
const MODULE_NAME = 'payment';
const FUNCTION_NAME = 'process_payment';
const SUI_NETWORK: 'testnet' | 'mainnet' | 'devnet' | 'localnet' = 'testnet'; // Or your target network

// --- Wallet Setup (Choose ONE method) ---

// Method 1: Using Mnemonic Phrase (Recommended for local testing)
// Ensure MNEMONIC environment variable is set in your .env file
/*
const mnemonic = process.env.MNEMONIC;
if (!mnemonic) {
    throw new Error('MNEMONIC environment variable not set.');
}
const keypair = MnemonicKeypair.deriveKeypair(mnemonic);
*/

// Method 2: Using Private Key (Less Secure - Use with caution)
// Ensure PRIVATE_KEY_B64 environment variable is set in your .env file
const privateKeyB64 = process.env.PRIVATE_KEY_B64;
if (!privateKeyB64) {
    throw new Error('PRIVATE_KEY_B64 environment variable not set.');
}
// Private key needs to be in Uint8Array format
const privateKeyBytes = fromB64(privateKeyB64); // Decode Base64 private key
const keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes.slice(1)); // Assuming first byte is scheme flag

const client = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK) });
const SENDER_ADDRESS = keypair.getPublicKey().toSuiAddress();
console.log(`Signer Address: ${SENDER_ADDRESS}`);

// --- Payment Details ---
const paymentId = `hatcher_1712384_100000000000_1712350_1747102690543`; // Unique payment ID
const additionalData = 'Data from TS client';
const paymentAmountMIST = 20000000; // 0.02 SUI in MIST (adjust as needed)

async function makePayment() {
    console.log('Attempting to make payment...');
    try {
        // 1. Find a suitable coin for payment
        console.log(`Fetching coins for address ${SENDER_ADDRESS}...`);
        const coins = await client.getCoins({ owner: SENDER_ADDRESS });
        console.log(`Found ${coins.data.length} coin objects.`);

        if (coins.data.length === 0) {
            throw new Error('No SUI coins found for the sender address. Please faucet.');
        }

        // --- Build the transaction block --- 
        const txb = new Transaction();
        txb.setSender(SENDER_ADDRESS); // Set the sender for the transaction block

        // 2. Split coins if necessary to get the exact payment amount
        const [paymentCoin] = txb.splitCoins(txb.gas, [paymentAmountMIST]);

        // 3. Add the Move Call
        txb.moveCall({
            target: `${PACKAGE_ID}::${MODULE_NAME}::${FUNCTION_NAME}`,
            arguments: [
                txb.object(TREASURY_ID),
                txb.pure.string(paymentId),
                txb.pure.string(additionalData),
                paymentCoin,
            ],
        });

        // --- Dry run the transaction --- 
        console.log('Performing dry run...');
        // Serialize the transaction block before sending it to dryRun
        const serializedTxb = await txb.build({ client: client }); 
        const dryRunResult = await client.dryRunTransactionBlock({
            transactionBlock: serializedTxb,
        });

        console.log('Dry Run Effects:', JSON.stringify(dryRunResult.effects, null, 2));

        if (dryRunResult.effects.status.status !== 'success') {
            console.error('Dry run failed:', dryRunResult.effects.status.error);
            throw new Error(`Dry run failed: ${dryRunResult.effects.status.error}`);
        }

        // --- Set Gas Budget based on Dry Run --- 
        const gasUsed = dryRunResult.effects.gasUsed;
        const gasBudget = BigInt(gasUsed.computationCost) 
                        + BigInt(gasUsed.storageCost) 
                        // storageRebate is subtracted, so add it back to budget if positive, 
                        // or add its absolute value if negative (though usually non-negative)
                        + BigInt(gasUsed.storageRebate) 
                        + BigInt(1000000); // Add a 1M MIST buffer

        console.log(`Dry Run Gas Used: Computation=${gasUsed.computationCost}, Storage=${gasUsed.storageCost}, Rebate=${gasUsed.storageRebate}`);
        console.log(`Setting Gas Budget to: ${gasBudget.toString()} MIST`);
        // No need to serialize again, setGasBudget modifies the original txb
        txb.setGasBudget(gasBudget);

        // 4. Sign and execute the transaction
        console.log('Signing and executing transaction...');
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: txb, // Use the same txb, now with gas budget set
            options: {
                showEffects: true,
                showEvents: true,
            },
        });

        console.log('Transaction successful!');
        console.log('Transaction Digest:', result.digest);
        // console.log('Effects:', JSON.stringify(result.effects, null, 2));
        // console.log('Events:', JSON.stringify(result.events, null, 2));

        // Find the PaymentProcessed event
        const paymentEvent = result.events?.find(
            (e: any) => e.type === `${PACKAGE_ID}::${MODULE_NAME}::PaymentProcessed`
        );
        if (paymentEvent) {
            console.log('Payment Processed Event:', paymentEvent.parsedJson);
        } else {
            console.log('PaymentProcessed event not found in transaction result.');
        }


    } catch (error) {
        console.error('Error making payment:', error);
        if (error instanceof Error && error.message.includes('InsufficientGas')) {
             console.error("Please ensure the signer address has enough SUI for gas and the payment amount.");
        }
    }
}

// Run the payment function
makePayment(); 