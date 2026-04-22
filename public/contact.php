<?php
header("Content-Type: application/json");

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

$input = json_decode(file_get_contents("php://input"), true);

$email = trim($input["email"] ?? "");
$name = trim($input["name"] ?? "");
$subjectInput = trim($input["subject"] ?? "");
$message = trim($input["message"] ?? "");

if (!$email || !$name || !$subjectInput || !$message) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "All fields are required"]);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid email address"]);
    exit;
}

$to = "sasireka_n@yahoo.com";
$subject = "Reka Gallery Contact: " . $subjectInput;

$body = "Email: $email\n";
$body .= "Name: $name\n";
$body .= "Subject: $subjectInput\n\n";
$body .= "Message:\n$message\n";

$headers = "From: noreply@rekagallery.vip\r\n";
$headers .= "Reply-To: $email\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

if (mail($to, $subject, $body, $headers)) {
    echo json_encode(["success" => true, "message" => "Message sent successfully"]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to send email"]);
}
?>
