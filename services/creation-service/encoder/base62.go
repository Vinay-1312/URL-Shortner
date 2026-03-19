package encoder

const base62Chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// ToBase62 encodes a positive integer to a base62 string.
// An input of 0 returns "0".
func ToBase62(n int64) string {
	if n == 0 {
		return "0"
	}

	base := int64(len(base62Chars)) // 62
	buf := make([]byte, 0, 11)      // log62(2^63) ≈ 10.7

	for n > 0 {
		buf = append(buf, base62Chars[n%base])
		n /= base
	}

	// Reverse (digits were appended least-significant first)
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}

	return string(buf)
}
