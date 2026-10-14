// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentWallet.sol";
import "../src/MockToken.sol";

contract AgentWalletTest is Test {
    AgentWallet wallet;
    MockToken token;

    address owner = address(this);
    address agent = address(0xA11CE);
    address recipient = address(0xB0B);
    address stranger = address(0xBAD);

    function setUp() public {
        token = new MockToken("Mock USD", "mUSD");
        wallet = new AgentWallet(agent, 100 ether, 150 ether);

        wallet.setTokenAllowed(address(token), true);
        wallet.setRecipientAllowed(recipient, true);

        token.approve(address(wallet), type(uint256).max);
        wallet.deposit(address(token), 1000 ether);
    }

    function testOwnerCanDeposit() public view {
        assertEq(token.balanceOf(address(wallet)), 1000 ether);
    }

    function testAgentCanExecuteValidTransfer() public {
        vm.prank(agent);
        wallet.executeTransfer(1, address(token), recipient, 50 ether);

        assertEq(token.balanceOf(recipient), 50 ether);
        assertEq(token.balanceOf(address(wallet)), 950 ether);
    }

    function testNonAgentCannotExecute() public {
        vm.prank(stranger);
        vm.expectRevert("not agent");
        wallet.executeTransfer(2, address(token), recipient, 50 ether);
    }

    function testRejectsDisallowedToken() public {
        MockToken badToken = new MockToken("Bad", "BAD");
        badToken.approve(address(wallet), type(uint256).max);

        vm.prank(agent);
        vm.expectRevert("token not allowed");
        wallet.executeTransfer(3, address(badToken), recipient, 1 ether);
    }

    function testRejectsDisallowedRecipient() public {
        vm.prank(agent);
        vm.expectRevert("recipient not allowed");
        wallet.executeTransfer(4, address(token), stranger, 1 ether);
    }

    function testRejectsOverMaxPerTx() public {
        vm.prank(agent);
        vm.expectRevert("exceeds max per transaction");
        wallet.executeTransfer(5, address(token), recipient, 101 ether);
    }

    function testRejectsOverDailyLimit() public {
        vm.prank(agent);
        wallet.executeTransfer(6, address(token), recipient, 100 ether);

        vm.prank(agent);
        vm.expectRevert("exceeds daily limit");
        wallet.executeTransfer(7, address(token), recipient, 100 ether);
    }

    function testPauseBlocksExecution() public {
        wallet.pause();

        vm.prank(agent);
        vm.expectRevert();
        wallet.executeTransfer(8, address(token), recipient, 1 ether);
    }

    function testOnlyOwnerCanPause() public {
        vm.prank(stranger);
        vm.expectRevert("not owner");
        wallet.pause();
    }

    function testCheckPolicyReturnsReason() public view {
        (bool ok, string memory reason) = wallet.checkPolicy(
            address(token),
            recipient,
            500 ether
        );
        assertFalse(ok);
        assertEq(reason, "exceeds max per transaction");
    }
}