// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RoboPay is Ownable {
    enum RobotStatus {
        AVAILABLE,
        IN_USE
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
        bool active;
        bool completed;
        bytes32 activityHash;
        bytes32 rentalDataHash;
    }

    address payable public immutable paymentRecipient;

    mapping(string => Robot) private robots;
    mapping(string => Rental) private rentals;
    mapping(string => bool) public orderExists;

    string[] private robotIds;
    string[] private rentalOrderIds;

    event RobotRegistered(
        string indexed robotId,
        string name,
        string service,
        address indexed robotOwner
    );

    event RobotAvailabilityChanged(
        string indexed robotId,
        RobotStatus status
    );

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

    event ActivityHashRecorded(
        string indexed orderId,
        string indexed robotId,
        bytes32 activityHash,
        uint256 timestamp
    );

    event RentalCompleted(
        string indexed orderId,
        string indexed robotId,
        address indexed customer,
        uint256 completedAt
    );

    constructor(address payable _paymentRecipient)
        Ownable(msg.sender)
    {
        require(
            _paymentRecipient != address(0),
            "Invalid payment recipient"
        );

        paymentRecipient = _paymentRecipient;
    }

    // ============================================================
    // ROBOT REGISTRATION
    // ============================================================

    function registerRobot(
        string calldata robotId,
        string calldata name,
        string calldata service
    )
        external
        onlyOwner
    {
        require(
            bytes(robotId).length > 0,
            "Robot ID required"
        );

        require(
            !robots[robotId].registered,
            "Robot already registered"
        );

        robots[robotId] = Robot({
            robotId: robotId,
            name: name,
            service: service,
            robotOwner: msg.sender,
            status: RobotStatus.AVAILABLE,
            registered: true
        });

        robotIds.push(robotId);

        emit RobotRegistered(
            robotId,
            name,
            service,
            msg.sender
        );
    }

    // ============================================================
    // ROBOT AVAILABILITY
    // ============================================================

    function setRobotAvailability(
        string calldata robotId,
        RobotStatus status
    )
        external
        onlyOwner
    {
        require(
            robots[robotId].registered,
            "Robot not registered"
        );

        robots[robotId].status = status;

        emit RobotAvailabilityChanged(
            robotId,
            status
        );
    }

    // ============================================================
    // INR PRICING
    // ============================================================

    function requiredAmountInr(
        string calldata robotId,
        uint256 durationMinutes
    )
        public
        pure
        returns (uint256)
    {
        bytes32 idHash =
            keccak256(abi.encodePacked(robotId));

        // RoboFollow
        if (
            idHash ==
            keccak256(abi.encodePacked("RF-01"))
        ) {
            if (durationMinutes == 1) {
                return 2;
            }

            if (durationMinutes == 2) {
                return 4;
            }

            if (durationMinutes == 3) {
                return 6;
            }
        }

        // RoboClean
        if (
            idHash ==
            keccak256(abi.encodePacked("FC-01"))
        ) {
            if (durationMinutes == 1) {
                return 2;
            }

            if (durationMinutes == 2) {
                return 4;
            }

            if (durationMinutes == 3) {
                return 6;
            }
        }

        // RoboTrolley
        if (
            idHash ==
            keccak256(abi.encodePacked("ST-01"))
        ) {
            if (durationMinutes == 1) {
                return 2;
            }

            if (durationMinutes == 2) {
                return 4;
            }

            if (durationMinutes == 3) {
                return 6;
            }
        }

        revert("Invalid robot/package");
    }

    // ============================================================
    // MST TESTNET PAYMENT
    // ============================================================

    function requiredPayment(
        string calldata robotId,
        uint256 durationMinutes
    )
        public
        pure
        returns (uint256)
    {
        bytes32 idHash =
            keccak256(abi.encodePacked(robotId));

        // RoboFollow
        if (
            idHash ==
            keccak256(abi.encodePacked("RF-01"))
        ) {
            if (durationMinutes == 1) {
                return 0.001 ether;
            }

            if (durationMinutes == 2) {
                return 0.002 ether;
            }

            if (durationMinutes == 3) {
                return 0.003 ether;
            }
        }

        // RoboClean
        if (
            idHash ==
            keccak256(abi.encodePacked("FC-01"))
        ) {
            if (durationMinutes == 1) {
                return 0.001 ether;
            }

            if (durationMinutes == 2) {
                return 0.002 ether;
            }

            if (durationMinutes == 3) {
                return 0.003 ether;
            }
        }

        // RoboTrolley
        if (
            idHash ==
            keccak256(abi.encodePacked("ST-01"))
        ) {
            if (durationMinutes == 1) {
                return 0.001 ether;
            }

            if (durationMinutes == 2) {
                return 0.002 ether;
            }

            if (durationMinutes == 3) {
                return 0.003 ether;
            }
        }

        revert("Invalid robot/package");
    }

    // ============================================================
    // RENTAL AUTHORIZATION
    // ============================================================

    function rentRobot(
        string calldata orderId,
        string calldata robotId,
        string calldata service,
        uint256 durationMinutes,
        uint256 amountInr
    )
        external
        payable
    {
        require(
            !orderExists[orderId],
            "Order already exists"
        );

        require(
            robots[robotId].registered,
            "Robot not registered"
        );

        require(
            robots[robotId].status ==
                RobotStatus.AVAILABLE,
            "Robot is not available"
        );

        uint256 expectedInr =
            requiredAmountInr(
                robotId,
                durationMinutes
            );

        require(
            amountInr == expectedInr,
            "Incorrect INR package"
        );

        uint256 expectedPayment =
            requiredPayment(
                robotId,
                durationMinutes
            );

        require(
            msg.value == expectedPayment,
            "Incorrect payment amount"
        );

        uint256 startTime =
            block.timestamp;

        uint256 endTime =
            startTime +
            (durationMinutes * 60);

        bytes32 rentalDataHash =
            keccak256(
                abi.encodePacked(
                    orderId,
                    robotId,
                    service,
                    durationMinutes,
                    amountInr,
                    msg.sender,
                    startTime,
                    endTime
                )
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
            active: true,
            completed: false,
            activityHash: bytes32(0),
            rentalDataHash: rentalDataHash
        });

        orderExists[orderId] = true;

        rentalOrderIds.push(orderId);

        robots[robotId].status =
            RobotStatus.IN_USE;

        emit RentalCreated(
            orderId,
            robotId,
            msg.sender,
            durationMinutes,
            amountInr,
            msg.value,
            startTime,
            endTime,
            rentalDataHash
        );

        (
            bool success,
        ) =
            paymentRecipient.call{
                value: msg.value
            }("");

        require(
            success,
            "Payment transfer failed"
        );
    }

    // ============================================================
    // ROBOT ACTIVITY AUDIT
    // ============================================================

    function recordActivityHash(
        string calldata orderId,
        bytes32 activityHash
    )
        external
        onlyOwner
    {
        require(
            orderExists[orderId],
            "Rental does not exist"
        );

        require(
            activityHash != bytes32(0),
            "Invalid activity hash"
        );

        Rental storage rental =
            rentals[orderId];

        rental.activityHash =
            activityHash;

        emit ActivityHashRecorded(
            orderId,
            rental.robotId,
            activityHash,
            block.timestamp
        );
    }

    // ============================================================
    // VERIFY ACTIVITY HASH
    // ============================================================

    function verifyActivityHash(
        string calldata orderId,
        bytes32 currentHash
    )
        external
        view
        returns (bool)
    {
        require(
            orderExists[orderId],
            "Rental does not exist"
        );

        return
            rentals[orderId].activityHash ==
            currentHash;
    }

    // ============================================================
    // VERIFY RENTAL DATA HASH
    // ============================================================

    function verifyRentalDataHash(
        string calldata orderId,
        bytes32 currentHash
    )
        external
        view
        returns (bool)
    {
        require(
            orderExists[orderId],
            "Rental does not exist"
        );

        return
            rentals[orderId].rentalDataHash ==
            currentHash;
    }

    // ============================================================
    // END RENTAL
    // ============================================================

    function endRental(
        string calldata orderId
    )
        external
    {
        require(
            orderExists[orderId],
            "Rental does not exist"
        );

        Rental storage rental =
            rentals[orderId];

        require(
            rental.active,
            "Rental is not active"
        );

        require(
            msg.sender == owner() ||
            msg.sender == rental.customer,
            "Not authorized"
        );

        rental.active = false;
        rental.completed = true;

        robots[rental.robotId].status =
            RobotStatus.AVAILABLE;

        emit RentalCompleted(
            orderId,
            rental.robotId,
            rental.customer,
            block.timestamp
        );
    }

    // ============================================================
    // GET ROBOT
    // ============================================================

    function getRobot(
        string calldata robotId
    )
        external
        view
        returns (
            string memory,
            string memory,
            string memory,
            address,
            RobotStatus,
            bool
        )
    {
        Robot memory robot =
            robots[robotId];

        require(
            robot.registered,
            "Robot not registered"
        );

        return (
            robot.robotId,
            robot.name,
            robot.service,
            robot.robotOwner,
            robot.status,
            robot.registered
        );
    }

    // ============================================================
    // GET RENTAL
    // ============================================================

    function getRental(
        string calldata orderId
    )
        external
        view
        returns (
            string memory,
            string memory,
            string memory,
            uint256,
            uint256,
            uint256,
            address,
            uint256,
            uint256,
            bool,
            bool,
            bytes32,
            bytes32
        )
    {
        require(
            orderExists[orderId],
            "Rental does not exist"
        );

        Rental memory rental =
            rentals[orderId];

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
            rental.active,
            rental.completed,
            rental.activityHash,
            rental.rentalDataHash
        );
    }

    // ============================================================
    // LIST ROBOTS
    // ============================================================

    function getRobotIds()
        external
        view
        returns (string[] memory)
    {
        return robotIds;
    }

    // ============================================================
    // LIST RENTALS
    // ============================================================

    function getRentalOrderIds()
        external
        view
        returns (string[] memory)
    {
        return rentalOrderIds;
    }

    // ============================================================
    // CONTRACT BALANCE
    // ============================================================

    function contractBalance()
        external
        view
        returns (uint256)
    {
        return address(this).balance;
    }

    // ============================================================
    // WITHDRAW
    // ============================================================

    function withdraw()
        external
        onlyOwner
    {
        uint256 balance =
            address(this).balance;

        require(
            balance > 0,
            "No balance"
        );

        (
            bool success,
        ) =
            paymentRecipient.call{
                value: balance
            }("");

        require(
            success,
            "Withdrawal failed"
        );
    }

    receive() external payable {}
}