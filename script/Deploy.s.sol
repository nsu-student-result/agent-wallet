// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/AgentWallet.sol";
import "../src/MockToken.sol";

contract DeployScript is Script {
    // Default Anvil accounts (well-known test keys)
    address constant AGENT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant RECIPIENT = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external {
        vm.startBroadcast();

        MockToken token = new MockToken("Mock USD", "mUSD");
        AgentWallet wallet = new AgentWallet(AGENT, 100 ether, 150 ether);

        wallet.setTokenAllowed(address(token), true);
        wallet.setRecipientAllowed(RECIPIENT, true);

        // Fund the wallet with 1000 mUSD
        token.approve(address(wallet), type(uint256).max);
        wallet.deposit(address(token), 120 ether);

        vm.stopBroadcast();

        console.log("MockToken:   ", address(token));
        console.log("AgentWallet: ", address(wallet));
    }
}