import os
import re
import cv2
import numpy as np
import pymupdf as fitz

def show(img, title="Image"):
	cv2.imshow(title, img)
	cv2.waitKey(0)
	cv2.destroyAllWindows()

def crop_image(image, x, y, w, h):
	# Crop the image using the provided coordinates
	return image[y:y+h, x:x+w]

def to_px(mm, dpi=300):
	"""Convert millimeters to pixels at the given DPI."""
	return int(mm * dpi / 25.4)

def to_mm(px, dpi=300):
	"""Convert pixels to millimeters at the given DPI."""
	return px * 25.4 / dpi

def create_blank_page(width, height):
	"""Create a blank page with the specified width and height."""
	return np.ones((height, width), dtype=np.uint8) * 255  # White page

def sanitize_string(value: str) -> str:
	"""Sanitize user-provided strings for use in filenames and paths.
	Strips path separators, null bytes, and non-printable characters.
	"""
	if value is None:
		return None
	value = value.replace('\x00', '').replace('/', '').replace('\\', '')
	value = re.sub(r'[^\x20-\x7E]', '', value)
	value = re.sub(r'\s+', ' ', value).strip()
	return value[:128]

# def example():
# 	staves_data = {} # Dictionary name: [y, h]
# 	staves = {}

# 	staves_data["fl"] = [100, 50]
# 	staves_data["picc"] = [150, 40]
# 	staves_data["EH"] = [190, 50]

# 	img = cv2.imread("./img/music.png")
# 	img_gray = cv2.imread("./img/music.png", cv2.IMREAD_GRAYSCALE)
# 	for staff in staves_data:
# 		x, w = (0, img.shape[1])
# 		y, h = staves_data[staff]
# 		staves[staff] = crop_image(img_gray, x, y, w, h)
# 		show(staves[staff], staff)

class Score:
	def __init__(self, path: str, title: str = None, composer: str = None, keep_temp_files: bool = False):
		self.keep_temp_files = keep_temp_files
		self.title = sanitize_string(title)
		self.composer = sanitize_string(composer)
		self.name = f"{self.composer}_{self.title}"
		self.path = path
		self.doc = self._load_pdf()
		self.pages: list[Page] = []
		self.parts: list[Part] = []
		self.parts_dict: dict[str, Part] = {}
	
	def _load_pdf(self):
		"""Load the PDF file and extract pages."""
		if not os.path.exists(self.path):
			raise FileNotFoundError(f"File not found: {self.path}")
		# Open the PDF file
		doc = fitz.open(self.path)
		return doc
	
	def _extract_pages(self, dpi=300):
		for page_number, page in enumerate(self.doc):
			# Render the page to a pixmap without transparency (alpha) and in grayscale
			pix = page.get_pixmap(dpi=dpi, alpha=False, colorspace="gray")
			if self.keep_temp_files:
				page_path = os.path.join(TMP_DIR, f"{self.name}_page_{page_number}.png")
				pix.save(page_path, output='png')
				page = Page.from_path(path=page_path, score=self, grayscale=True)
			else:
				page = Page.from_pixmap(pix, score=self)
			# Append the page to the score
			self.pages.append(page)

class PageError(Exception):
	"""Base exception for Page-related errors."""
	pass

class PageLoadError(PageError):
	"""Raised when loading a page fails."""
	pass

class Page:
	def __init__(self, score: Score = None):
		self.score: Score = score
		self.path: str = None
		self.staves: list[Staff] = []
		self.img = None
	
	@classmethod
	def from_path(cls, path: str, score: Score = None, grayscale: bool = True):
		"""Create a Page instance from a file path."""
		page = cls(score=score)
		page.path = path
		if not os.path.exists(path):
			raise PageLoadError(f"File not found: {path}")
		page.img = cv2.imread(path, cv2.IMREAD_GRAYSCALE) if grayscale else cv2.imread(path)
		if page.img is None:
			raise PageLoadError(f"Failed to load image: {path}")
		return page

	@classmethod
	def from_pixmap(cls, pixmap: fitz.Pixmap, score: Score = None):
		page = cls(score=score)
		page.img = cls._pixmap_to_numpy(pixmap)
		return page

	def to_png_bytes(self) -> bytes:
		"""Encode the page image as PNG bytes for HTTP response."""
		success, buffer = cv2.imencode('.png', self.img)
		if not success:
			raise PageError("Failed to encode page image as PNG")
		return buffer.tobytes()

	@staticmethod
	def _pixmap_to_numpy(pixmap):
		"""Convert a PyMuPDF pixmap to a NumPy array."""
		# Get pixmap info
		samples = pixmap.samples
		width = pixmap.width
		height = pixmap.height
		
		# Create numpy array from pixmap samples
		if pixmap.n == 1:  # Grayscale
			return np.frombuffer(samples, dtype=np.uint8).reshape(height, width)
		else:  # RGB or RGBA
			return np.frombuffer(samples, dtype=np.uint8).reshape(height, width, pixmap.n)

class StaffError(Exception):
	"""Base exception for Staff-related errors."""
	pass
		
class Staff:
	def __init__(self, name: str, short_name: str, y: int, h: int, page: Page = None):
		self.page: Page = page
		self.score: Score = self.page.score if self.page else None
		self.name = name
		self.short_name = short_name
		self.y = y
		self.h = h
		self.img = self._crop()

	def _crop(self):
		if self.page is None:
			raise StaffError("Page not set for this staff.")
		x, w = (0, self.page.img.shape[1])
		y, h = (self.y, self.h)
		try:
			img = crop_image(self.page.img, x, y, w, h)
		except Exception as e:
			raise StaffError(f"Error cropping staff image: {e}")
		return img

class PartError(Exception):
	"""Base exception for Part-related errors."""
	pass

class PartLoadError(PartError):
	"""Raised when loading a part fails."""
	pass

class PartSaveError(PartError):
	"""Raised when saving a part fails."""
	pass

class Part:
	def __init__(self, name: str, short_name: str, staves: list[Staff]):
		self.name = name
		self.short_name = short_name
		self.staves: list[Staff] = staves
		self.pages = []
		self.width = max([staff.img.shape[1] for staff in staves]) if staves else 0
		self.spacing = 0
	
	def _reset_y_pos(self):
		if not self.pages:
			return self.margins['top'] + self.title_area
		else:
			return self.margins['top']
	
	def _adapt_staff(self, staff: Staff):
		staff_height, staff_width = staff.img.shape[:2]
		scale_factor = self.available_width / staff_width 
		# Calculate new dimensions
		new_width = int(staff_width * scale_factor)
		new_height = int(staff_height * scale_factor)
		# Resize the staff image
		if scale_factor != 1.0:
			staff_img_resized = cv2.resize(staff.img, (new_width, new_height))
		else:
			staff_img_resized = staff.img
		return staff_img_resized

	def _layout(self, page_format: str = "A4", dpi: int = 300):
		if page_format == "A4": # in mm
			width_mm, height_mm = 210, 297
			margins_mm = {'top': 20, 'bottom': 15, 'left': 15, 'right': 15}
			title_area_mm = 30  # Space for title on first page
			system_spacing_mm = 12  # Space between staves
			# Convert to pixels
			self.width = to_px(width_mm - margins_mm['left'] - margins_mm['right'], dpi)
			self.height = to_px(height_mm - margins_mm['top'] - margins_mm['bottom'], dpi)
			self.spacing = to_px(system_spacing_mm, dpi)
			self.title_area = to_px(title_area_mm, dpi)
			self.margins = {
				'top': to_px(margins_mm['top'], dpi),
				'bottom': to_px(margins_mm['bottom'], dpi),
				'left': to_px(margins_mm['left'], dpi),
				'right': to_px(margins_mm['right'], dpi)
			}
		else:
			raise ValueError(f"Unsupported page format: {page_format}")
		self.available_width = self.width - self.margins['left'] - self.margins['right']
		self.available_height = self.height - self.margins['top'] - self.margins['bottom']

	def process(self):
		if self.staves:
			self.width = max(staff.img.shape[1] for staff in self.staves)
		self._layout(dpi=100)
		# Create a blank page with the specified dimensions
		page = create_blank_page(self.width, self.height)  # White page
		y_pos = self._reset_y_pos()
		for staff in self.staves:
			# Resize staff image to fit the page width respecting margins
			# staff_img_resized = cv2.resize(staff.img, (self.width - self.margins['left'] - self.margins['right'], staff.img.shape[0]))
			staff_img_resized = self._adapt_staff(staff)
			# Check that the resized image fits within the page
			if staff_img_resized.shape[1] > self.width - self.margins['left'] - self.margins['right']:
				raise PartError(f"Staff image width exceeds page width: {staff.name}")
			# Place the staff image on the page
			page[y_pos:y_pos + staff_img_resized.shape[0], self.margins['left']:self.margins['left'] + staff_img_resized.shape[1]] = staff_img_resized
			y_pos += staff_img_resized.shape[0] + self.spacing
			# If the page height is exceeded, create a new page
			if y_pos + staff_img_resized.shape[0] > self.height - self.margins['bottom']:
				self.pages.append(page)
				page = create_blank_page(self.width, self.height)
				y_pos = self._reset_y_pos()
		self.pages.append(page)

def example_page():
	try:
		page = (Page("./img/music.png", grayscale=True))
		# show(page.img, "Page")
		# page_wrong = (Page("./img/wrong", grayscale=False))
		return page
	except PageLoadError as e:
		print(f"Error loading page: {e}")

def example_score():
	try:
		score = Score(SCORE_PATH, title= "Bella mia fiamma", composer="W. A. Mozart", keep_temp_files=True)
		score._extract_pages()
	except FileNotFoundError as e:
		print(f"Error loading score: {e}")
		return None
	return score

def example():
	score = example_score()
	# exit()
	# page = example_page()
	names = ["flute", "piccolo", "English Horn"]
	short_names = ["fl", "picc", "EH"]
	assert len(names) == len(short_names), "Names and short names must have the same length"
	name_idx = 0
	parts = [] # will be a list attribute of the score
	parts_dict = {} # will be a dict attribute of the score
	h = 50
	for page in score.pages:
		cuts = range(0, page.img.shape[0], h) # example cut positions all at the same distance
		for cut in cuts:
			# Create a staff for each cut
			name = names[name_idx]
			short_name = short_names[name_idx]
			staff = Staff(name, short_name, cut, h, page)
			# Append the staff to the page
			page.staves.append(staff)
			# Add the staff to the right part
			# Check if the part already exists
			if name in parts_dict:
				part = parts_dict[name]
				# print(f"Adding staff {name} to existing part {part.name}")
			else:
				# Create a new part
				part = Part(name, short_name, [])
				parts_dict[name] = part
				parts.append(part)
				# print(f"Adding new part {name}")
			part.staves.append(staff)
			# Spin the name
			name_idx = (name_idx + 1) % len(names)

		# for staff in page.staves:
		# 	show(staff.img, staff.name)

	for part in parts:
		# print(f"Part: {part.name} has {len(part.staves)} staves")
		part.process()
		# for i, page in enumerate(part.pages):
		# 	show(page, f"Part: {part.name} - Page {i+1}")

TMP_DIR = os.path.join(os.path.dirname(__file__), "tmp")
PAGE_PATH = "./img/music.png"
SCORE_PATH = "./img/score.pdf"

if __name__ == "__main__":
	if not os.path.exists(TMP_DIR):
		os.makedirs(TMP_DIR)
	example()