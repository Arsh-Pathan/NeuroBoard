import pytesseract
import base64
import numpy as np
import cv2


class MathRecognizer:
    def extract_text(self, image_base64: str) -> str:
        """
        Decodes a base64 image and uses OpenCV preprocessing + pytesseract
        to extract mathematical equations from handwriting.

        Pipeline: Grayscale -> Gaussian Blur -> Otsu Thresholding -> OCR
        """
        # Decode base64
        encoded_data = image_base64.split(",", 1)[-1] if "," in image_base64 else image_base64
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return ""

        # Step 1: Grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Step 2: Gaussian Blur to reduce noise from rough handwriting
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Step 3: Otsu thresholding for adaptive binarization
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

        # Step 4: Invert if background is light (canvas is light gray)
        # Check if more than half of pixels are white (light bg)
        white_ratio = np.sum(thresh == 255) / thresh.size
        if white_ratio > 0.5:
            thresh = cv2.bitwise_not(thresh)

        # Dilate slightly to connect broken strokes in handwriting
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        thresh = cv2.dilate(thresh, kernel, iterations=1)

        # Invert back for tesseract (expects dark text on light bg)
        thresh = cv2.bitwise_not(thresh)

        # OCR config for math characters — try multiple PSM modes
        configs = [
            r"--psm 7 -c tessedit_char_whitelist=0123456789+-*/=xyXY().^ ",
            r"--psm 6 -c tessedit_char_whitelist=0123456789+-*/=xyXY().^ ",
            r"--psm 13 -c tessedit_char_whitelist=0123456789+-*/=xyXY().^ ",
        ]

        for config in configs:
            text = pytesseract.image_to_string(thresh, config=config).strip()
            if text and any(c.isdigit() or c in "xyXY" for c in text):
                return text

        return ""
