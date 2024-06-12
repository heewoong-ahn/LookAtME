import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { LookBookRepository } from 'src/repositories/lookbooks.repository';
import { SaveLookBookDto } from './dtos/save-lookbook.dto';
import { TopLookBookRepository } from 'src/repositories/top-lookbooks.repository';
import { AccessoryLookBookRepository } from 'src/repositories/accessory-lookbooks.repository';
import { Top } from 'src/entities/clothes/tops.entity';
import { Accessory } from 'src/entities/clothes/accessories.entity';
import { UserLookBookSaveRepository } from 'src/repositories/user-lookbook-save.repository';
import { UserLookBookLikeRepository } from 'src/repositories/user-lookbook-like.repository';
import { CommentService } from 'src/comment/comment.service';
import { S3Service } from 'src/s3/s3.service';
import { MannequinLookBookRepository } from 'src/repositories/mannequin-lookbooks.repository';
import { LookBookCollectionRequestDto } from './dtos/lookbook-collection-request.dto';
import { LookBookCollectionResponseDataDto } from './dtos/lookbook-collection-response-data.dto';

@Injectable()
export class LookbookService {
  constructor(
    private readonly lookBookRepository: LookBookRepository,
    private readonly topLookBookRepository: TopLookBookRepository,
    private readonly accessoryLookBookRepository: AccessoryLookBookRepository,
    private readonly userLookBookSaveRepository: UserLookBookSaveRepository,
    private readonly userLookBookLikeRepository: UserLookBookLikeRepository,
    private readonly commentService: CommentService,
    private readonly s3Service: S3Service,
    private readonly mannequinLookBookRepository: MannequinLookBookRepository,
  ) {}

  async saveLookBook(
    mannequinLookBook: Express.Multer.File,
    saveLookBookDto: SaveLookBookDto,
    userId: number,
  ) {
    console.log(saveLookBookDto.type);
    const { topIds, accessoryIds, pantId, shoeId, ...saveLookbookData } =
      saveLookBookDto;

    const lookbook = await this.lookBookRepository.saveLookBook(
      saveLookbookData,
      userId,
      pantId,
      shoeId,
    );

    topIds.map(async (topId) => {
      const top = new Top();
      top.id = topId;

      await this.topLookBookRepository.topToLookbook(top, lookbook);
    });

    accessoryIds.map(async (accessoryId) => {
      const accessory = new Accessory();
      accessory.id = accessoryId;

      await this.accessoryLookBookRepository.accessoryToLookbook(
        accessory,
        lookbook,
      );
    });

    //마네킹-룩북 사진 저장.

    const url = await this.s3Service.uploadFile(
      mannequinLookBook,
      'mannequin-lookbook',
    );
    await this.mannequinLookBookRepository.uploadMannequinLookBook(
      url,
      userId,
      saveLookbookData.title,
      saveLookbookData.type,
      saveLookbookData.memo,
    );

    return;
  }

  async showNotShow(lookbookId: number, userId: number) {
    //변경을 원하는 lookbook의 소유가 자신의 것인지 확인 후 작업
    const lookBook = await this.lookBookRepository.findLookBookById(lookbookId);
    if (!lookBook) {
      throw new NotFoundException('해당 룩북이 존재하지 않습니다.');
    }
    if (!(lookBook.userId == userId)) {
      throw new ForbiddenException(
        '다른 계정의 룩북에 대한 접근으로 권한이 없습니다.',
      );
    }
    return await this.lookBookRepository.showNotShow(lookBook);
  }

  async clipNotClip(lookbookId: number, userId: number) {
    const userLookBookSave = await this.userLookBookSaveRepository.clippedOrNot(
      lookbookId,
      userId,
    );
    //찜 해제하기
    if (userLookBookSave) {
      return await this.userLookBookSaveRepository.notClipLookBook(
        userLookBookSave,
      );
    }

    const lookbook = await this.lookBookRepository.findLookBookById(lookbookId);
    if (!lookbook) {
      throw new NotFoundException('해당 룩북이 존재하지 않습니다.');
    }
    return await this.userLookBookSaveRepository.clipLookBook(
      lookbookId,
      userId,
    );
  }

  async likeNotLike(lookbookId: number, userId: number) {
    const userLookBookLike = await this.userLookBookLikeRepository.likedOrNot(
      lookbookId,
      userId,
    );
    //좋아요 해제하기
    if (userLookBookLike) {
      await this.lookBookRepository.notLikeLookBook(lookbookId);
      return await this.userLookBookLikeRepository.notLikeLookBook(
        userLookBookLike,
      );
    }
    //좋아요
    await this.lookBookRepository.likeLookBook(lookbookId);
    return await this.userLookBookLikeRepository.likeLookBook(
      lookbookId,
      userId,
    );
  }

  async deleteMannequinLookBook(mannequinLookBookId: number, userId: number) {
    const mannequinLookBook =
      await this.mannequinLookBookRepository.findMannequinLookBookById(
        mannequinLookBookId,
      );
    if (!mannequinLookBook) {
      throw new NotFoundException(
        '삭제하려는 마네킹-룩북이 존재하지 않습니다.',
      );
    }
    if (mannequinLookBook.userId != userId) {
      throw new ForbiddenException(
        '해당 마네킹-룩북에 대한 삭제 권한이 없습니다.',
      );
    }

    //transaction으로 적용되어야 함.

    await this.mannequinLookBookRepository.hardDeleteMannequinLookBook(
      mannequinLookBook,
    );

    //s3에서 삭제.

    await this.s3Service.deleteMannequinLookBook(mannequinLookBook.url);

    return;
  }

  async deleteLookBook(lookbookId: number, userId: number) {
    const lookbook = await this.lookBookRepository.findLookBookById(lookbookId);
    if (!lookbook) {
      throw new NotFoundException('삭제하려는 룩북이 존재하지 않습니다.');
    }
    if (lookbook.userId != userId) {
      throw new ForbiddenException('해당 룩북에 대한 삭제 권한이 없습니다.');
    }

    //추후 transaction을 적용하든 일괄 적용되게 해야함.

    await this.lookBookRepository.deleteLookBook(lookbook);

    //룩북을 soft delete했을 시 댓글을 모두 hard delete

    await this.commentService.hardDeleteAllLookBookRelatedComment(lookbookId);

    return;
  }

  async getLookBookCollection(
    lookBookCollectionRequestDto: LookBookCollectionRequestDto,
  ): Promise<LookBookCollectionResponseDataDto> {
    const result = await this.lookBookRepository.getLookBookCollection(
      lookBookCollectionRequestDto,
    );

    let cursor: number = null;
    let hasNext: boolean;
    //metadata 설정
    //take개수보다 작으면 false가 됨.
    const take = lookBookCollectionRequestDto.take;
    if (!lookBookCollectionRequestDto.cursor) {
      hasNext = result.length > lookBookCollectionRequestDto.take * 2;
    } else {
      hasNext = result.length > lookBookCollectionRequestDto.take;
    }

    //다음으로 줄 값이 없다면
    if (!hasNext) {
      cursor = null;
    }
    //다음으로 줄 값이 있다면
    else {
      cursor = result[result.length - 2].id;
    }

    //클라이언트 반환은 hasNext위해 불렀던 추가 데이터 빼고 반환.
    if (hasNext) {
      result.pop();
    }
    const response = new LookBookCollectionResponseDataDto(result, {
      take,
      hasNext,
      cursor,
    });

    return response;
  }
}
