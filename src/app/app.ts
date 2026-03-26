import { ChangeDetectionStrategy, Component, HostListener, signal, computed, effect, ViewChild, ElementRef, AfterViewInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Background3DComponent } from './background-3d.component';
import { SLIDES } from './slides.data';
import { animate, stagger, cubicBezier } from 'motion';
import confetti from 'canvas-confetti';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [Background3DComponent, MatIconModule],
  template: `
    <app-background-3d [slideIndex]="currentIndex()" [slideId]="currentSlide().id"></app-background-3d>

    <div class="relative z-10 w-full h-screen overflow-hidden flex flex-col items-center justify-center pointer-events-none">
      
      <!-- Star Wars Crawl for Title Slide -->
      @if (currentSlide().isTitleSlide && currentSlide().id === 'title') {
        <div class="absolute inset-0 flex items-center justify-center perspective-[800px]">
          <div #crawlContainer class="w-[80%] max-w-3xl text-center text-[var(--color-starwars-yellow)] font-starwars transform-gpu rotate-x-[20deg] origin-bottom">
            <h1 class="text-7xl md:text-9xl mb-8 uppercase tracking-widest">{{ currentSlide().title }}</h1>
            @for (line of currentSlide().content; track $index) {
              <p class="text-3xl md:text-5xl mb-4 uppercase tracking-wider">{{ line }}</p>
            }
            <p class="mt-12 text-xl opacity-70 animate-pulse">Druk op spatie of pijltje naar rechts om te beginnen</p>
          </div>
        </div>
      } @else {
        <!-- Regular Slide Content -->
        <div #slideContainer class="w-full max-w-5xl mx-auto p-8 md:p-12 bg-black/60 backdrop-blur-md border border-[var(--color-starwars-yellow)]/30 rounded-2xl shadow-[0_0_30px_rgba(255,232,31,0.1)] pointer-events-auto">
          <h2 class="text-4xl md:text-6xl font-starwars text-[var(--color-starwars-yellow)] mb-8 uppercase tracking-wider border-b border-[var(--color-starwars-yellow)]/30 pb-4">
            {{ currentSlide().title }}
          </h2>
          
          <div class="space-y-6 text-lg md:text-2xl font-sans text-gray-200 leading-relaxed">
            @for (line of currentSlide().content; track $index) {
              <p class="slide-item">{{ line }}</p>
            }
          </div>

          @if (currentSlide().experiment) {
            <div class="mt-8 p-6 bg-green-900/30 border border-green-500/50 rounded-xl slide-item">
              <h3 class="text-2xl font-starwars text-green-400 mb-4 flex items-center gap-3">
                <mat-icon>science</mat-icon> {{ currentSlide().experiment?.title }}
              </h3>
              <p class="text-green-200/80 mb-4 text-sm md:text-base">{{ currentSlide().experiment?.description }}</p>
              <ul class="list-disc list-inside space-y-2 text-green-100">
                @for (instruction of currentSlide().experiment?.instructions; track $index) {
                  <li>{{ instruction }}</li>
                }
              </ul>
            </div>
          }

          @if (currentSlide().quiz) {
            @let quiz = currentSlide().quiz!;
            <div class="mt-8 slide-item">
              <!-- Knock-out Quiz UI -->
              @if (currentQuizQuestionIndex() < quiz.length) {
                @let q = quiz[currentQuizQuestionIndex()];
                <div class="bg-blue-900/40 border border-blue-500/50 rounded-xl p-6 md:p-8 shadow-[0_0_20px_rgba(59,130,246,0.2)]">
                  <div class="flex justify-between items-center mb-6">
                    <span class="text-blue-400 font-starwars text-xl tracking-widest">Vraag {{ currentQuizQuestionIndex() + 1 }} van {{ quiz.length }}</span>
                  </div>
                  
                  <p class="text-2xl md:text-3xl text-white font-medium mb-8">{{ q.question }}</p>
                  
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    @for (option of q.options; track $index) {
                      <div class="p-4 rounded-lg border-2 transition-all duration-300 flex items-center justify-center text-xl font-bold text-center"
                           [class]="isAnswerRevealed() 
                                    ? ($index === q.correctOptionIndex 
                                        ? 'bg-green-600/50 border-green-400 text-white shadow-[0_0_15px_rgba(74,222,128,0.5)] scale-105' 
                                        : 'bg-red-900/30 border-red-500/30 text-gray-400 opacity-50 scale-95')
                                    : 'bg-blue-800/30 border-blue-400/50 text-blue-100'">
                        {{ option }}
                      </div>
                    }
                  </div>

                  @if (isAnswerRevealed()) {
                    <div class="mb-8 p-4 bg-green-900/30 border border-green-500/50 rounded-lg animate-fade-in">
                      <p class="text-green-200 text-lg">{{ q.explanation }}</p>
                    </div>
                  }

                  <div class="flex justify-end">
                    @if (!isAnswerRevealed()) {
                      <button (click)="revealAnswer()" class="px-6 py-3 bg-[var(--color-starwars-yellow)] text-black font-starwars tracking-widest rounded-lg hover:bg-yellow-400 transition-colors">
                        Toon Antwoord
                      </button>
                    } @else {
                      <button (click)="nextQuizQuestion()" class="px-6 py-3 bg-blue-600 text-white font-starwars tracking-widest rounded-lg hover:bg-blue-500 transition-colors">
                        {{ currentQuizQuestionIndex() === quiz.length - 1 ? 'Einde Afvalrace' : 'Volgende Vraag' }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="bg-green-900/40 border border-green-500/50 rounded-xl p-12 text-center shadow-[0_0_30px_rgba(74,222,128,0.3)]">
                  <mat-icon class="text-6xl text-[var(--color-starwars-yellow)] mb-4" style="height: 60px; width: 60px; font-size: 60px;">emoji_events</mat-icon>
                  <h3 class="text-4xl font-starwars text-[var(--color-starwars-yellow)] mb-4 tracking-widest">Gefeliciteerd!</h3>
                  <p class="text-2xl text-green-100">Jullie zijn de ultieme Jupiter-experts!</p>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Navigation Controls -->
      <div class="absolute bottom-8 left-0 right-0 flex justify-between px-12 pointer-events-auto">
        <button 
          (click)="prevSlide()" 
          [disabled]="currentIndex() === 0 || isTransitioning()"
          class="p-3 rounded-full bg-black/50 border border-[var(--color-starwars-yellow)]/50 text-[var(--color-starwars-yellow)] hover:bg-[var(--color-starwars-yellow)] hover:text-black transition-all disabled:opacity-30 disabled:hover:bg-black/50 disabled:hover:text-[var(--color-starwars-yellow)] backdrop-blur-sm">
          <mat-icon>chevron_left</mat-icon>
        </button>
        
        <div class="text-[var(--color-starwars-yellow)]/70 font-starwars text-xl tracking-widest">
          {{ currentIndex() + 1 }} / {{ totalSlides() }}
        </div>

        <button 
          (click)="nextSlide()" 
          [disabled]="currentIndex() === totalSlides() - 1 || isTransitioning()"
          class="p-3 rounded-full bg-black/50 border border-[var(--color-starwars-yellow)]/50 text-[var(--color-starwars-yellow)] hover:bg-[var(--color-starwars-yellow)] hover:text-black transition-all disabled:opacity-30 disabled:hover:bg-black/50 disabled:hover:text-[var(--color-starwars-yellow)] backdrop-blur-sm">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-in {
      animation: fadeIn 0.5s ease-out forwards;
    }
    .perspective-1000 { perspective: 1000px; }
    .transform-style-3d { transform-style: preserve-3d; }
    .backface-hidden { backface-visibility: hidden; }
    .rotate-y-180 { transform: rotateY(180deg); }
    .perspective-\\[800px\\] {
      perspective: 800px;
    }
    .rotate-x-\\[20deg\\] {
      transform: rotateX(20deg);
    }
  `]
})
export class App implements AfterViewInit {
  slides = SLIDES;
  currentIndex = signal(0);
  currentQuizQuestionIndex = signal(0);
  isAnswerRevealed = signal(false);
  isTransitioning = signal(false);
  direction = signal<1 | -1>(1);
  private isBrowser: boolean;
  private platformId = inject(PLATFORM_ID);

  currentSlide = computed(() => this.slides[this.currentIndex()]);
  totalSlides = computed(() => this.slides.length);

  @ViewChild('slideContainer') slideContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('crawlContainer') crawlContainer?: ElementRef<HTMLDivElement>;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    effect(() => {
      // Reset quiz state when slide changes
      const current = this.currentSlide();
      if (current.quiz) {
        this.currentQuizQuestionIndex.set(0);
        this.isAnswerRevealed.set(false);
      }
      
      // Animate new slide content
      if (this.isBrowser) {
        setTimeout(() => this.animateSlideIn(), 50);
      }
    });
  }

  ngAfterViewInit() {
    if (this.isBrowser) {
      this.animateSlideIn();
    }
  }

  async animateSlideOut(dir: number) {
    if (!this.isBrowser) return;
    
    const customEase = cubicBezier(0.4, 0, 0.2, 1);
    const animations: Promise<unknown>[] = [];

    if (this.crawlContainer?.nativeElement) {
      animations.push(
        animate(
          this.crawlContainer.nativeElement,
          { 
            y: [0, dir === 1 ? '-50vh' : '50vh'],
            opacity: [1, 0],
            filter: ['blur(0px)', 'blur(10px)']
          },
          { duration: 0.5, ease: customEase }
        ).finished
      );
    }

    if (this.slideContainer?.nativeElement) {
      animations.push(
        animate(
          this.slideContainer.nativeElement,
          { 
            x: [0, dir === 1 ? -150 : 150],
            opacity: [1, 0],
            filter: ['blur(0px)', 'blur(12px)'],
            scale: [1, 0.9]
          },
          { duration: 0.5, ease: customEase }
        ).finished
      );
    }

    if (animations.length > 0) {
      await Promise.all(animations);
    }
  }

  animateSlideIn() {
    if (!this.isBrowser) return;

    const customEase = cubicBezier(0.16, 1, 0.3, 1);
    const dir = this.direction();

    if (this.crawlContainer?.nativeElement) {
      animate(
        this.crawlContainer.nativeElement,
        { 
          y: [dir === 1 ? '50vh' : '-50vh', '0vh'],
          opacity: [0, 1],
          rotateX: [40, 20],
          filter: ['blur(10px)', 'blur(0px)']
        },
        { duration: 1.5, ease: 'easeOut' }
      ).finished.then(() => this.isTransitioning.set(false));
    }

    if (this.slideContainer?.nativeElement) {
      const items = this.slideContainer.nativeElement.querySelectorAll('.slide-item');
      
      animate(
        this.slideContainer.nativeElement,
        { 
          opacity: [0, 1], 
          scale: [0.9, 1],
          x: [dir === 1 ? 150 : -150, 0],
          filter: ['blur(12px)', 'blur(0px)']
        },
        { duration: 0.8, ease: customEase }
      ).finished.then(() => {
        this.isTransitioning.set(false);
      });

      if (items.length > 0) {
        animate(
          items,
          { 
            opacity: [0, 1], 
            x: [dir === 1 ? 30 : -30, 0],
            filter: ['blur(8px)', 'blur(0px)']
          },
          { delay: stagger(0.05), duration: 0.6, ease: customEase }
        );
      }
    } else if (!this.crawlContainer?.nativeElement) {
       setTimeout(() => this.isTransitioning.set(false), 500);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.isTransitioning()) return;
    if (event.key === 'ArrowRight' || event.key === ' ') {
      this.nextSlide();
    } else if (event.key === 'ArrowLeft') {
      this.prevSlide();
    }
  }

  async nextSlide() {
    if (this.currentIndex() < this.totalSlides() - 1 && !this.isTransitioning()) {
      this.isTransitioning.set(true);
      this.direction.set(1);
      await this.animateSlideOut(1);
      this.currentIndex.update(i => i + 1);
    }
  }

  async prevSlide() {
    if (this.currentIndex() > 0 && !this.isTransitioning()) {
      this.isTransitioning.set(true);
      this.direction.set(-1);
      await this.animateSlideOut(-1);
      this.currentIndex.update(i => i - 1);
    }
  }

  revealAnswer() {
    this.isAnswerRevealed.set(true);
    if (this.isBrowser) {
      // Fire confetti when revealing the answer
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.5 },
        colors: ['#ffe81f', '#0044ff', '#ff3300', '#4ade80']
      });
    }
  }

  nextQuizQuestion() {
    this.isAnswerRevealed.set(false);
    this.currentQuizQuestionIndex.update(i => i + 1);
  }
}
