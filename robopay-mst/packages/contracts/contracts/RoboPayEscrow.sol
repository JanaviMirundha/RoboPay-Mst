// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RoboPayEscrow is Ownable, ReentrancyGuard {
    enum RobotStatus {
        AVAILABLE,
        IN_USE
    }

    enum RentalStatus {
        ACTIVE,
        COMPLETED,
        REFUNDED
    }

    struct Robot {
        string robotId;
        string name;
        string service;
        address robotOwner;
        RobotStatus status;
        bool registered;
    }

    struct Rental {
        string orderId;
        string robotId;
        string service;
        uint256 durationMinutes;
        uint256 amountInr;
        uint256 amountPaidWei;
        address customer;
        uint256 startTime;
        uint256 endTime;
        RentalStatus status;
        bytes32 rentalDataHash;
        bytes32 activityHash;
        bytes32 failureReasonHash;
        uint256 settledAt;
    }

    address payable public immutable paymentRecipient;
    mapping(string => Robot) private robots;
    mapping(string => Rental) private rentals;
    mapping(string => bool) public orderExists;
    mapping(string => uint256) public escrowedAmount;
    string[] private robotIds;
    string[] private rentalOrderIds;

    event RobotRegistered(string indexed robotId, string name, string service, address indexed robotOwner);
    event RobotAvailabilityChanged(string indexed robotId, RobotStatus status);
    event RentalCreated(
        string indexed orderId,
        string indexed robotId,
        address indexed customer,
        uint256 durationMinutes,
        uint256 amountInr,
        uint256 amountPaidWei,
        uint256 startTime,
        uint256 endTime,
        bytes32 rentalDataHash
    );
    event ActivityHashRecorded(string indexed orderId, string indexed robotId, bytes32 activityHash, uint256 timestamp);
    event RentalSettled(string indexed orderId, string indexed robotId, address indexed recipient, uint256 amount, uint256 settledAt);
    event RentalCompleted(string indexed orderId, string indexed robotId, address indexed customer, uint256 completedAt);
    event RentalRefunded(
        string indexed orderId,
        string indexed robotId,
        address indexed customer,
        uint256 amount,
        bytes32 failureReasonHash,
        bytes32 activityHash,
        uint256 refundedAt
    );

    constructor(address payable adminAddress) Ownable(adminAddress) {
        require(adminAddress != address(0), "Invalid admin address");
        paymentRecipient = adminAddress;

        _registerRobot("RF-01", "RoboFollow", "Human Following");
        _registerRobot("FC-01", "RoboClean", "Floor Cleaning");
        _registerRobot("ST-01", "RoboTrolley", "Smart Shopping Trolley");
        _registerRobot("RC-01", "RoboCourier", "Autonomous Parcel Delivery");
    }

    function renounceOwnership() public view override onlyOwner {
        revert("Ownership renouncement disabled");
    }

    function registerRobot(string calldata robotId, string calldata name, string calldata service) external onlyOwner {
        require(bytes(robotId).length > 0, "Robot ID required");
        require(bytes(name).length > 0 && bytes(service).length > 0, "Robot metadata required");
        require(!robots[robotId].registered, "Robot already registered");

        _registerRobot(robotId, name, service);
    }

    function _registerRobot(string memory robotId, string memory name, string memory service) private {
        robots[robotId] = Robot({
            robotId: robotId,
            name: name,
            service: service,
            robotOwner: owner(),
            status: RobotStatus.AVAILABLE,
            registered: true
        });
        robotIds.push(robotId);
        emit RobotRegistered(robotId, name, service, owner());
        emit RobotAvailabilityChanged(robotId, RobotStatus.AVAILABLE);
    }

    function requiredAmountInr(string calldata robotId, uint256 durationMinutes) public pure returns (uint256) {
        bytes32 robotKey = keccak256(bytes(robotId));
        if (robotKey == keccak256("RF-01")) {
            if (durationMinutes == 1) return 2;
            if (durationMinutes == 2) return 4;
            if (durationMinutes == 3) return 6;
        }
        if (robotKey == keccak256("FC-01")) {
            if (durationMinutes == 1) return 2;
            if (durationMinutes == 2) return 4;
            if (durationMinutes == 3) return 6;
        }
        if (robotKey == keccak256("ST-01")) {
            if (durationMinutes == 1) return 2;
            if (durationMinutes == 2) return 4;
            if (durationMinutes == 3) return 6;
        }
        if (robotKey == keccak256("RC-01")) {
            if (durationMinutes == 1) return 2;
            if (durationMinutes == 2) return 4;
            if (durationMinutes == 3) return 6;
        }
        revert("Invalid robot/package");
    }

    function requiredPayment(string calldata robotId, uint256 durationMinutes) public pure returns (uint256) {
        bytes32 robotKey = keccak256(bytes(robotId));
        if (robotKey == keccak256("RF-01")) {
            if (durationMinutes == 1) return 0.001 ether;
            if (durationMinutes == 2) return 0.002 ether;
            if (durationMinutes == 3) return 0.003 ether;
        }
        if (robotKey == keccak256("FC-01")) {
            if (durationMinutes == 1) return 0.001 ether;
            if (durationMinutes == 2) return 0.002 ether;
            if (durationMinutes == 3) return 0.003 ether;
        }
        if (robotKey == keccak256("ST-01")) {
            if (durationMinutes == 1) return 0.001 ether;
            if (durationMinutes == 2) return 0.002 ether;
            if (durationMinutes == 3) return 0.003 ether;
        }
        if (robotKey == keccak256("RC-01")) {
            if (durationMinutes == 1) return 0.001 ether;
            if (durationMinutes == 2) return 0.002 ether;
            if (durationMinutes == 3) return 0.003 ether;
        }
        revert("Invalid robot/package");
    }

    function rentRobot(
        string calldata orderId,
        string calldata robotId,
        string calldata service,
        uint256 durationMinutes,
        uint256 amountInr
    ) external payable {
        require(bytes(orderId).length > 0, "Order ID required");
        require(!orderExists[orderId], "Order already exists");
        Robot storage robot = robots[robotId];
        require(robot.registered, "Robot not registered");
        require(robot.status == RobotStatus.AVAILABLE, "Robot is not available");
        require(keccak256(bytes(service)) == keccak256(bytes(robot.service)), "Incorrect robot service");
        require(amountInr == requiredAmountInr(robotId, durationMinutes), "Incorrect INR package");
        uint256 expectedPayment = requiredPayment(robotId, durationMinutes);
        require(msg.value == expectedPayment, "Incorrect payment amount");

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + durationMinutes * 60;
        bytes32 rentalDataHash = keccak256(
            abi.encode(orderId, robotId, service, durationMinutes, amountInr, msg.sender, startTime, endTime)
        );

        rentals[orderId] = Rental({
            orderId: orderId,
            robotId: robotId,
            service: service,
            durationMinutes: durationMinutes,
            amountInr: amountInr,
            amountPaidWei: msg.value,
            customer: msg.sender,
            startTime: startTime,
            endTime: endTime,
            status: RentalStatus.ACTIVE,
            rentalDataHash: rentalDataHash,
            activityHash: bytes32(0),
            failureReasonHash: bytes32(0),
            settledAt: 0
        });
        orderExists[orderId] = true;
        escrowedAmount[orderId] = msg.value;
        rentalOrderIds.push(orderId);
        robot.status = RobotStatus.IN_USE;

        emit RobotAvailabilityChanged(robotId, RobotStatus.IN_USE);
        emit RentalCreated(orderId, robotId, msg.sender, durationMinutes, amountInr, msg.value, startTime, endTime, rentalDataHash);
    }

    function recordActivityHash(string calldata orderId, bytes32 activityHash) external onlyOwner {
        require(orderExists[orderId], "Rental does not exist");
        require(activityHash != bytes32(0), "Invalid activity hash");
        Rental storage rental = rentals[orderId];
        require(rental.status == RentalStatus.ACTIVE, "Rental is not active");
        require(rental.activityHash == bytes32(0), "Activity hash already recorded");
        rental.activityHash = activityHash;
        emit ActivityHashRecorded(orderId, rental.robotId, activityHash, block.timestamp);
    }

    function settleRental(string calldata orderId) external onlyOwner nonReentrant {
        require(orderExists[orderId], "Rental does not exist");
        Rental storage rental = rentals[orderId];
        require(rental.status == RentalStatus.ACTIVE, "Rental is not active");
        require(block.timestamp >= rental.endTime, "Rental has not ended");
        require(rental.activityHash != bytes32(0), "Activity hash required");
        uint256 amount = escrowedAmount[orderId];
        require(amount == rental.amountPaidWei && address(this).balance >= amount, "Insufficient escrow");

        rental.status = RentalStatus.COMPLETED;
        rental.settledAt = block.timestamp;
        escrowedAmount[orderId] = 0;
        robots[rental.robotId].status = RobotStatus.AVAILABLE;
        emit RobotAvailabilityChanged(rental.robotId, RobotStatus.AVAILABLE);
        emit RentalSettled(orderId, rental.robotId, paymentRecipient, amount, block.timestamp);
        emit RentalCompleted(orderId, rental.robotId, rental.customer, block.timestamp);

        (bool success,) = paymentRecipient.call{value: amount}("");
        require(success, "Admin settlement transfer failed");
    }

    function refundRental(string calldata orderId, bytes32 failureReasonHash) external onlyOwner nonReentrant {
        require(orderExists[orderId], "Rental does not exist");
        require(failureReasonHash != bytes32(0), "Failure evidence hash required");
        Rental storage rental = rentals[orderId];
        require(rental.status == RentalStatus.ACTIVE, "Rental is not active");
        require(rental.activityHash != bytes32(0), "Activity hash required");
        uint256 amount = escrowedAmount[orderId];
        require(amount == rental.amountPaidWei && address(this).balance >= amount, "Insufficient escrow");

        rental.status = RentalStatus.REFUNDED;
        rental.failureReasonHash = failureReasonHash;
        rental.settledAt = block.timestamp;
        escrowedAmount[orderId] = 0;
        robots[rental.robotId].status = RobotStatus.AVAILABLE;
        emit RobotAvailabilityChanged(rental.robotId, RobotStatus.AVAILABLE);
        emit RentalRefunded(orderId, rental.robotId, rental.customer, amount, failureReasonHash, rental.activityHash, block.timestamp);

        (bool success,) = payable(rental.customer).call{value: amount}("");
        require(success, "Customer refund transfer failed");
    }

    function getRobot(string calldata robotId)
        external
        view
        returns (
            string memory id,
            string memory name,
            string memory service,
            address robotOwner,
            RobotStatus status,
            bool registered
        )
    {
        require(robots[robotId].registered, "Robot not registered");
        Robot storage robot = robots[robotId];
        return (robot.robotId, robot.name, robot.service, robot.robotOwner, robot.status, robot.registered);
    }

    function getRobotIds() external view returns (string[] memory) {
        return robotIds;
    }

    function getRental(string calldata orderId)
        external
        view
        returns (
            string memory rentalOrderId,
            string memory robotId,
            string memory service,
            uint256 durationMinutes,
            uint256 amountInr,
            uint256 amountPaidWei,
            address customer,
            uint256 startTime,
            uint256 endTime,
            RentalStatus status,
            bytes32 rentalDataHash,
            bytes32 activityHash,
            bytes32 failureReasonHash,
            uint256 settledAt
        )
    {
        require(orderExists[orderId], "Rental does not exist");
        Rental storage rental = rentals[orderId];
        return (
            rental.orderId,
            rental.robotId,
            rental.service,
            rental.durationMinutes,
            rental.amountInr,
            rental.amountPaidWei,
            rental.customer,
            rental.startTime,
            rental.endTime,
            rental.status,
            rental.rentalDataHash,
            rental.activityHash,
            rental.failureReasonHash,
            rental.settledAt
        );
    }

    function getRentalOrderIds() external view returns (string[] memory) {
        return rentalOrderIds;
    }

    function verifyActivityHash(string calldata orderId, bytes32 currentHash) external view returns (bool) {
        require(orderExists[orderId], "Rental does not exist");
        return currentHash != bytes32(0) && rentals[orderId].activityHash == currentHash;
    }

    function verifyRentalDataHash(string calldata orderId, bytes32 currentHash) external view returns (bool) {
        require(orderExists[orderId], "Rental does not exist");
        return currentHash != bytes32(0) && rentals[orderId].rentalDataHash == currentHash;
    }
}